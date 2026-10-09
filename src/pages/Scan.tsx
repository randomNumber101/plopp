import { useEffect, useRef, useState } from 'react'
import { findBeerByEan, offLookup } from '../api'
import { ErrorBox, Spinner } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'
import { beep, getEngine, gtinValid, normalizeCode, unlockAudio, type Engine, type Hit, type Point } from '../scanner'

type Status = 'idle' | 'starting' | 'scanning' | 'found' | 'looking'

/** Suchrahmen relativ zur Kameraansicht (Mitte) */
const FRAME = { w: 0.84, h: 0.46 }
const CAM_KEY = 'bier-camera'
const HINT_AFTER_MS = 7000

interface ZoomCap {
  min: number
  max: number
  value: number
}

function loadCam() {
  try {
    return localStorage.getItem(CAM_KEY)
  } catch {
    return null
  }
}
function saveCam(id: string) {
  try {
    localStorage.setItem(CAM_KEY, id)
  } catch {
    /* egal */
  }
}

export default function Scan() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runRef = useRef(0) // erhöht sich bei jedem Start/Stopp → alte Schleifen beenden sich
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const [candidate, setCandidate] = useState(false)
  const [outline, setOutline] = useState<{ pts: string; ok: boolean } | null>(null)
  const [torch, setTorch] = useState<boolean | null>(null) // null = nicht verfügbar
  const [zoom, setZoom] = useState<ZoomCap | null>(null)
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState<string | null>(loadCam)

  function stop() {
    runRef.current++
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setTorch(null)
    setZoom(null)
    setOutline(null)
    setCandidate(false)
    setHint(false)
  }

  // Kamera beim Verlassen der Seite bzw. im Hintergrund freigeben
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && streamRef.current) {
        stop()
        setStatus('idle')
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      stop()
    }
  }, [])

  // Automatisch starten, wenn die Kamera schon erlaubt wurde
  useEffect(() => {
    let alive = true
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (alive && p.state === 'granted') start()
      })
      .catch(() => {})
    // Erkennung schon vorladen
    getEngine().catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openStream(deviceId: string | null) {
    const base: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // @ts-expect-error – nicht in allen TS-DOM-Typen enthalten
      advanced: [{ focusMode: 'continuous' }],
    }
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: { exact: deviceId } }, audio: false })
      } catch {
        /* Kamera gibt es nicht mehr → Standard */
      }
    }
    return navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: { ideal: 'environment' } }, audio: false })
  }

  async function start(deviceId: string | null = camId) {
    stop()
    const run = runRef.current
    unlockAudio()
    setError(null)
    setCode(null)
    setStatus('starting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Dieser Browser unterstützt keinen Kamerazugriff.')
      const [stream, engine] = await Promise.all([openStream(deviceId), getEngine()])
      if (run !== runRef.current) return stream.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play().catch(() => {})

      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean
        zoom?: { min: number; max: number }
      }
      const settings = track.getSettings() as MediaTrackSettings & { zoom?: number }
      setTorch(caps.torch ? false : null)
      setZoom(caps.zoom && caps.zoom.max > caps.zoom.min ? { ...caps.zoom, value: settings.zoom ?? caps.zoom.min } : null)
      if (settings.deviceId) setCamId(settings.deviceId)

      // Rückkameras auflisten (Beschriftungen gibt es erst nach der Kamera-Freigabe)
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      const back = all.filter((d) => /back|rück|rear|environment|hinten/i.test(d.label))
      setCams(back.length > 1 ? back : all)

      setStatus('scanning')
      loop(run, engine)
    } catch (e) {
      if (run !== runRef.current) return
      stop()
      setStatus('idle')
      const err = e as Error
      setError(
        err.name === 'NotAllowedError'
          ? 'Kamerazugriff wurde verweigert. Erlaube ihn in den Browser-Einstellungen oder gib den Barcode unten von Hand ein.'
          : err.name === 'NotFoundError'
            ? 'Keine Kamera gefunden. Gib den Barcode unten von Hand ein.'
            : `Kamera konnte nicht gestartet werden (${err.message}). Gib den Barcode unten von Hand ein.`,
      )
    }
  }

  /** Erkennungsschleife: abwechselnd der Suchrahmen in voller Auflösung und das ganze Bild */
  async function loop(run: number, engine: Engine) {
    const video = videoRef.current!
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const seen = new Map<string, { n: number; t: number }>()
    const startedAt = Date.now()
    let frame = 0
    let lastHitAt = 0

    while (run === runRef.current) {
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh || video.readyState < 2) {
        await sleep(100)
        continue
      }
      frame++
      let hits: Hit[] = []
      try {
        const crop = frame % 2 === 1
        const r = crop ? frameRect(video) : { x: 0, y: 0, w: vw, h: vh }
        // Große Bilder verkleinern (Tempo), den Suchrahmen in Originalauflösung lesen (kleine Barcodes)
        const scale = Math.min(1, (crop ? 1600 : 1280) / Math.max(r.w, r.h))
        canvas.width = Math.round(r.w * scale)
        canvas.height = Math.round(r.h * scale)
        ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height)
        hits = (await engine.detect(canvas)).map((h) => ({
          ...h,
          points: h.points.map((p) => ({ x: r.x + p.x / scale, y: r.y + p.y / scale })),
        }))
      } catch {
        /* einzelnes Bild fehlgeschlagen – weiter */
      }
      if (run !== runRef.current) return

      const now = Date.now()
      const hit = hits.find(plausible)
      if (hit) {
        lastHitAt = now
        const c = normalizeCode(hit.code, hit.format)
        const s = seen.get(c)
        const n = s && now - s.t < 1500 ? s.n + 1 : 1
        seen.set(c, { n, t: now })
        const confirmed = n >= 2
        setOutline({ pts: toScreen(hit.points, video), ok: confirmed })
        setCandidate(true)
        if (confirmed) {
          runRef.current++
          if (navigator.vibrate) navigator.vibrate(60)
          beep()
          setCode(c)
          setStatus('found')
          video.pause() // Standbild mit markiertem Barcode stehen lassen
          await sleep(450)
          return handle(c)
        }
      } else if (now - lastHitAt > 500) {
        setOutline(null)
        setCandidate(false)
      }
      if (now - startedAt > HINT_AFTER_MS && now - lastHitAt > 3000) setHint(true)
      else if (hit) setHint(false)

      await sleep(engine.kind === 'native' ? 50 : 15)
    }
  }

  async function handle(raw: string) {
    const ean = normalizeCode(raw)
    if (ean.length < 8) return setError('Ungültiger Barcode – mindestens 8 Ziffern.')
    setCode(ean)
    setStatus('looking')
    try {
      const beer = await findBeerByEan(ean)
      if (beer) return go(`/beer/${beer.id}`)
      const off = await offLookup(ean)
      setPrefill({
        ean,
        name: off?.name,
        brand: off?.brand,
        imageUrl: off?.imageUrl,
        abv: off?.abv,
        fromOff: !!off,
      })
      go('/new')
    } catch (e) {
      stop()
      setStatus('idle')
      setError((e as Error).message)
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || torch === null) return
    try {
      // @ts-expect-error – torch ist nicht in allen TS-DOM-Typen enthalten
      await track.applyConstraints({ advanced: [{ torch: !torch }] })
      setTorch(!torch)
    } catch {
      setTorch(null)
    }
  }

  async function setZoomTo(value: number) {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || !zoom) return
    const v = Math.min(zoom.max, Math.max(zoom.min, value))
    try {
      // @ts-expect-error – zoom ist nicht in allen TS-DOM-Typen enthalten
      await track.applyConstraints({ advanced: [{ zoom: v }] })
      setZoom({ ...zoom, value: v })
    } catch {
      /* egal */
    }
  }

  function nextCamera() {
    if (cams.length < 2) return
    const i = cams.findIndex((c) => c.deviceId === camId)
    const next = cams[(i + 1) % cams.length].deviceId
    saveCam(next)
    setCamId(next)
    start(next)
  }

  const live = status === 'scanning' || status === 'starting' || status === 'found'
  const showVideo = live || (status === 'looking' && !!streamRef.current)
  const zoomSteps = zoom ? [1, 2, 3].filter((z) => z >= zoom.min && z <= zoom.max) : []

  return (
    <div className="page">
      <h2>Bier scannen</h2>
      <div className={`scanner ${showVideo ? 'active' : ''} ${status === 'found' ? 'found' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay />

        {live && (
          <>
            <div className={`scan-frame ${candidate ? 'candidate' : ''}`} style={{ width: `${FRAME.w * 100}%`, height: `${FRAME.h * 100}%` }}>
              <i className="c tl" />
              <i className="c tr" />
              <i className="c bl" />
              <i className="c br" />
              {status === 'scanning' && !candidate && <div className="scan-line" />}
            </div>
            {outline && (
              <svg className="scan-outline" width="100%" height="100%">
                <polygon points={outline.pts} className={outline.ok ? 'ok' : ''} />
              </svg>
            )}
          </>
        )}

        {status === 'scanning' && (
          <div className="scan-tools">
            {torch !== null && (
              <button className={torch ? 'on' : ''} onClick={toggleTorch} aria-label="Licht">
                🔦
              </button>
            )}
            {cams.length > 1 && (
              <button onClick={nextCamera} aria-label="Andere Kamera">
                🔄
              </button>
            )}
            {zoomSteps.length > 1 &&
              zoomSteps.map((z) => (
                <button key={z} className={Math.round(zoom!.value) === z ? 'on' : ''} onClick={() => setZoomTo(z)}>
                  {z}×
                </button>
              ))}
          </div>
        )}

        {live && (
          <div className={`scan-status ${status === 'found' ? 'ok' : candidate ? 'warn' : ''}`}>
            {status === 'starting' && 'Kamera startet …'}
            {status === 'scanning' && (candidate ? 'Erkannt – kurz stillhalten …' : 'Barcode in den Rahmen halten')}
            {status === 'found' && `✓ ${code}`}
          </div>
        )}

        {status === 'idle' && (
          <button className="btn btn-primary btn-big" onClick={() => start()}>
            📷 {error ? 'Nochmal versuchen' : 'Kamera starten'}
          </button>
        )}
        {status === 'looking' && (
          <div className="scanner-overlay">
            <Spinner />
            <span>Suche Bier …</span>
            {code && <span className="small mono">{code}</span>}
          </div>
        )}
      </div>

      {status === 'scanning' && hint && (
        <div className="scan-hint">
          Kein Barcode erkannt? Halte das Handy <b>15–25 cm</b> entfernt und den Strich-Code quer im Rahmen.
          {torch !== null && ' Bei wenig Licht 🔦 einschalten.'}
          {cams.length > 1 && ' Unscharf? Mit 🔄 die Kamera wechseln.'}
          {zoomSteps.length > 1 && ' Kleine Codes: 2× zoomen.'}
        </div>
      )}

      {live && (
        <button
          className="btn"
          onClick={() => {
            stop()
            setStatus('idle')
          }}
        >
          Abbrechen
        </button>
      )}
      <ErrorBox msg={error} />

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          stop()
          handle(manual)
        }}
      >
        <input
          inputMode="numeric"
          placeholder="Barcode von Hand eingeben"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button className="btn" disabled={manual.replace(/\D/g, '').length < 8}>
          Suchen
        </button>
      </form>
      {manual.replace(/\D/g, '').length >= 8 && !gtinValid(normalizeCode(manual)) && (
        <p className="muted small">Hinweis: Die Prüfziffer passt nicht – vielleicht vertippt?</p>
      )}

      <div className="divider">oder</div>
      <button className="btn" onClick={() => go('/catalog')}>
        🔎 Bier ohne Barcode suchen / anlegen
      </button>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Codes mit Prüfziffer müssen stimmen; sonst mind. 8 Ziffern */
function plausible(h: Hit) {
  const digits = h.code.replace(/\D/g, '')
  if (/ean|upc|itf/i.test(h.format)) return gtinValid(normalizeCode(h.code, h.format)) || gtinValid(digits)
  return digits.length >= 8 && digits.length <= 14 && digits.length === h.code.length
}

/** Suchrahmen in Video-Pixeln (berücksichtigt object-fit: cover) */
function frameRect(video: HTMLVideoElement) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const ew = video.clientWidth || vw
  const eh = video.clientHeight || vh
  const s = Math.max(ew / vw, eh / vh)
  // sichtbarer Ausschnitt des Videos
  const visW = ew / s
  const visH = eh / s
  // etwas großzügiger als der gezeichnete Rahmen
  const w = Math.min(vw, visW * Math.min(1, FRAME.w + 0.1))
  const h = Math.min(vh, visH * Math.min(1, FRAME.h + 0.2))
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
}

/** Video-Pixel → Bildschirmkoordinaten im Scanner-Element */
function toScreen(points: Point[], video: HTMLVideoElement) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const ew = video.clientWidth
  const eh = video.clientHeight
  const s = Math.max(ew / vw, eh / vh)
  const dx = (ew - vw * s) / 2
  const dy = (eh - vh * s) / 2
  return points.map((p) => `${(p.x * s + dx).toFixed(1)},${(p.y * s + dy).toFixed(1)}`).join(' ')
}
