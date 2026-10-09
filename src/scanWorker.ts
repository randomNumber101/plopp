/// <reference lib="webworker" />
// Barcode-Erkennung mit ZXing-C++ (WebAssembly) in einem eigenen Thread:
// Die Kameravorschau bleibt flüssig, egal wie lange ein Bild dauert.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
})

let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null

self.onmessage = async (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = e.data
  try {
    const w = bitmap.width
    const h = bitmap.height
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h)
      ctx = canvas.getContext('2d', { willReadFrequently: true })
    }
    ctx!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const img = ctx!.getImageData(0, 0, w, h)
    const res = await readBarcodes(img, {
      formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF', 'Code128', 'Code39'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      tryDownscale: true,
      maxNumberOfSymbols: 2,
    })
    const hits = res
      .filter((r) => r.isValid && r.text)
      .map((r) => ({
        code: r.text.trim(),
        format: String(r.format),
        points: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft],
      }))
    self.postMessage({ id, hits })
  } catch (err) {
    try {
      bitmap.close()
    } catch {
      /* schon geschlossen */
    }
    self.postMessage({ id, hits: [], error: String(err) })
  }
}
