import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { findBeerByEan, offLookup } from '../api'
import { ErrorBox, Spinner } from '../components'
import { go } from '../router'
import { setPrefill } from '../store'

export default function Scan() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const handledRef = useRef(false)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'looking'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  function stop() {
    controlsRef.current?.stop()
    controlsRef.current = null
  }

  useEffect(() => stop, [])

  async function start() {
    setError(null)
    handledRef.current = false
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ])
    const reader = new BrowserMultiFormatReader(hints)
    try {
      setStatus('scanning')
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current!,
        (result) => {
          if (result && !handledRef.current) {
            handledRef.current = true
            if (navigator.vibrate) navigator.vibrate(80)
            stop()
            handle(result.getText())
          }
        },
      )
    } catch (e) {
      setStatus('idle')
      setError(
        'Kamera konnte nicht gestartet werden. Erlaube den Kamerazugriff in den Browser-Einstellungen ' +
          `oder gib den Barcode unten von Hand ein. (${(e as Error).message})`,
      )
    }
  }

  async function handle(code: string) {
    const ean = code.replace(/\D/g, '')
    if (ean.length < 8) return setError('Ungültiger Barcode.')
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
      setStatus('idle')
      setError((e as Error).message)
    }
  }

  return (
    <div className="page">
      <h2>Bier scannen</h2>
      <div className={`scanner ${status === 'scanning' ? 'active' : ''}`}>
        <video ref={videoRef} playsInline muted />
        {status === 'scanning' && <div className="scan-line" />}
        {status === 'idle' && (
          <button className="btn btn-primary btn-big" onClick={start}>
            📷 Kamera starten
          </button>
        )}
        {status === 'looking' && (
          <div className="scanner-overlay">
            <Spinner />
            <span>Suche Bier …</span>
          </div>
        )}
      </div>
      {status === 'scanning' && (
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

      <div className="divider">oder</div>
      <button className="btn" onClick={() => go('/catalog')}>
        🔎 Bier ohne Barcode suchen / anlegen
      </button>
    </div>
  )
}
