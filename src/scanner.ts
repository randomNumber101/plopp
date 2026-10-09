// Barcode-Erkennung: nativer BarcodeDetector (Android/Chrome) oder ZXing-C++ als WebAssembly (iPhone, Firefox …).
// Beides ist deutlich zuverlässiger als die frühere reine JavaScript-Variante.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export interface Point {
  x: number
  y: number
}

export interface Hit {
  code: string
  format: string
  /** Eckpunkte in Video-Pixeln */
  points: Point[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Engine {
  /** native = BarcodeDetector des Systems (Android/Chrome), worker = ZXing in eigenem Thread, wasm = ZXing im Hauptthread */
  kind: 'native' | 'worker' | 'wasm'
  /** Ausschnitt r des Videos (oder das ganze Bild) prüfen – Treffer in Video-Pixeln */
  scan(video: HTMLVideoElement, r: Rect | null): Promise<Hit[]>
}

/** Formate auf Getränken: EAN/UPC (Flasche, Dose), ITF-14 (Kasten), Code 128/39 (seltener) */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'code_39']

interface RawBarcode {
  rawValue: string
  format: string
  cornerPoints: readonly Point[]
}
interface DetectorLike {
  detect(src: CanvasImageSource): Promise<RawBarcode[]>
}

const toHits = (res: RawBarcode[]): Hit[] =>
  res.map((b) => ({ code: b.rawValue.trim(), format: b.format, points: [...b.cornerPoints] })).filter((h) => h.code)

/** Nativ: das Video direkt übergeben – kein Umkopieren über ein Canvas, die Erkennung läuft im System */
function nativeEngine(d: DetectorLike): Engine {
  return {
    kind: 'native',
    async scan(video) {
      return toHits(await d.detect(video))
    },
  }
}

/** Ausschnitt verkleinert als Bitmap (läuft auf der Grafikkarte, blockiert die Vorschau kaum) */
function grab(video: HTMLVideoElement, r: Rect | null, max: number) {
  const rect = r ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }
  const scale = Math.min(1, max / Math.max(rect.w, rect.h))
  const w = Math.max(1, Math.round(rect.w * scale))
  const h = Math.max(1, Math.round(rect.h * scale))
  return { rect, scale, w, h }
}

const mapBack = (hits: Hit[], rect: Rect, scale: number) =>
  hits.map((h) => ({ ...h, points: h.points.map((p) => ({ x: rect.x + p.x / scale, y: rect.y + p.y / scale })) }))

function workerEngine(): Engine {
  const worker = new Worker(new URL('./scanWorker.ts', import.meta.url), { type: 'module' })
  let id = 0
  const pending = new Map<number, (hits: Hit[]) => void>()
  worker.onmessage = (e: MessageEvent<{ id: number; hits: Hit[] }>) => {
    pending.get(e.data.id)?.(e.data.hits)
    pending.delete(e.data.id)
  }
  return {
    kind: 'worker',
    async scan(video, r) {
      const { rect, scale, w, h } = grab(video, r, r ? 1400 : 1100)
      const bitmap = await createImageBitmap(video, rect.x, rect.y, rect.w, rect.h, {
        resizeWidth: w,
        resizeHeight: h,
        resizeQuality: 'medium',
      })
      const my = ++id
      const hits = await new Promise<Hit[]>((resolve) => {
        pending.set(my, resolve)
        worker.postMessage({ id: my, bitmap }, [bitmap])
        setTimeout(() => pending.has(my) && (pending.delete(my), resolve([])), 4000)
      })
      return mapBack(hits, rect, scale)
    },
  }
}

function mainThreadEngine(d: DetectorLike): Engine {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return {
    kind: 'wasm',
    async scan(video, r) {
      const { rect, scale, w, h } = grab(video, r, r ? 1200 : 960)
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h)
      return mapBack(toHits(await d.detect(canvas)), rect, scale)
    },
  }
}

let enginePromise: Promise<Engine> | null = null

export function getEngine(): Promise<Engine> {
  enginePromise ??= createEngine().catch((e) => {
    enginePromise = null
    throw e
  })
  return enginePromise
}

async function createEngine(): Promise<Engine> {
  const Native = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector
  if (Native?.getSupportedFormats) {
    try {
      const supported: string[] = await Native.getSupportedFormats()
      if (supported.includes('ean_13')) {
        return nativeEngine(new Native({ formats: FORMATS.filter((f) => supported.includes(f)) }))
      }
    } catch {
      /* weiter mit WebAssembly */
    }
  }
  // ZXing in einem eigenen Thread, wenn der Browser das kann (Chrome, Firefox, Safari ab iOS 16.4)
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    try {
      return workerEngine()
    } catch {
      /* weiter im Hauptthread */
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  // WebAssembly-Datei von der eigenen Seite laden (funktioniert offline und ohne fremdes CDN)
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
  })
  const det = new BarcodeDetector({ formats: FORMATS as never })
  return mainThreadEngine(det as unknown as DetectorLike)
}

/** Prüfziffer für EAN-8/EAN-13/UPC-A/ITF-14 (GTIN) */
export function gtinValid(code: string) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** UPC-E (8 Stellen) → UPC-A (12 Stellen) */
function upcEtoA(e: string) {
  const [ns, d1, d2, d3, d4, d5, d6, check] = e.split('')
  let body: string
  if ('012'.includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  return ns + body + check
}

/** Vereinheitlicht einen gescannten Code: UPC → EAN-13, nur Ziffern */
export function normalizeCode(code: string, format = ''): string {
  let c = code.replace(/\D/g, '')
  if (/upc[_-]?e/i.test(format) && c.length === 8) c = upcEtoA(c)
  if (c.length === 12) c = '0' + c // UPC-A ist EAN-13 mit führender 0
  return c
}

/** Mögliche Schreibweisen eines Codes in der Datenbank */
export function codeVariants(code: string): string[] {
  const c = code.replace(/\D/g, '')
  const v = new Set([c])
  if (c.length === 12) v.add('0' + c)
  if (c.length === 13 && c.startsWith('0')) v.add(c.slice(1))
  if (c.length === 14 && c.startsWith('0')) v.add(c.slice(1))
  return [...v]
}

/** Kurzer Piepton als Bestätigung */
let audio: AudioContext | null = null
export function beep() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    audio ??= new AC()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.type = 'sine'
    o.frequency.value = 1320
    g.gain.setValueAtTime(0.0001, audio.currentTime)
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.15)
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + 0.16)
  } catch {
    /* egal */
  }
}

/** Töne freischalten: Browser erlauben Audio erst nach einer Berührung */
export function unlockAudio() {
  const resume = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      audio ??= new AC()
      if (audio.state === 'suspended') void audio.resume()
    } catch {
      /* egal */
    }
  }
  if (navigator.userActivation?.isActive ?? true) resume()
  else window.addEventListener('pointerdown', resume, { once: true })
}
