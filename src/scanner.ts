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

export interface Engine {
  kind: 'native' | 'wasm'
  detect(src: CanvasImageSource): Promise<Hit[]>
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

function wrap(kind: Engine['kind'], d: DetectorLike): Engine {
  return {
    kind,
    async detect(src) {
      const res = await d.detect(src)
      return res
        .map((b) => ({ code: b.rawValue.trim(), format: b.format, points: [...b.cornerPoints] }))
        .filter((h) => h.code)
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
        return wrap('native', new Native({ formats: FORMATS.filter((f) => supported.includes(f)) }))
      }
    } catch {
      /* weiter mit WebAssembly */
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
  return wrap('wasm', det as unknown as DetectorLike)
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
  if (/upc_e/i.test(format) && c.length === 8) c = upcEtoA(c)
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
