/**
 * „Turm teilen“: zeichnet den Kastenturm als Story-Bild (1080×1920) und gibt es ans Teilen-Menü
 * bzw. lädt es herunter, wenn das Gerät keine Dateien teilen kann.
 */
export interface PosterInput {
  beers: number
  crates: { stripes: string[] }[]
  since: string
  title: string
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

export async function drawTowerPoster(p: PosterInput): Promise<Blob | null> {
  const W = 1080
  const H = 1920
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) return null
  try {
    await Promise.all([document.fonts.load('900 120px "Big Shoulders Display"'), document.fonts.load('700 40px Barlow')])
  } catch {
    /* Schrift fehlt: Ersatzschrift reicht */
  }
  g.fillStyle = '#1b1f4a'
  g.fillRect(0, 0, W, H)
  // ein paar Glühbirnen oben
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,217,102,.55)' : 'rgba(255,217,102,.9)'
    g.beginPath()
    g.arc(90 + i * 112, 80, 12, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = '#ffd966'
  g.font = '900 170px "Big Shoulders Display", Barlow, sans-serif'
  g.textBaseline = 'alphabetic'
  g.fillText(`${p.beers} Biere`, 90, 320)
  g.fillStyle = '#c9ccf2'
  g.font = '700 46px Barlow, sans-serif'
  g.fillText(p.title, 94, 400)

  const left = 90
  const width = W - 180
  const top = 480
  const bottom = H - 230
  const n = Math.min(p.crates.length, 14)
  const gap = n > 8 ? 10 : 16
  const bandH = Math.max(36, Math.min(130, Math.floor((bottom - top - gap * n) / (n + 1))))
  let y = bottom - bandH
  // Turm von unten nach oben: ältester unten
  const list = p.crates.slice(-n)
  for (let i = 0; i < list.length; i++) {
    roundRect(g, left, y, width, bandH, 12)
    g.fillStyle = '#1e7a46'
    g.fill()
    g.fillStyle = '#0f4d2b'
    g.fillRect(left, y + bandH - 8, width, 8)
    const pad = Math.max(8, Math.round(bandH / 4))
    const sw = (width - 40) / list[i].stripes.length
    list[i].stripes.forEach((col, k) => {
      g.fillStyle = col
      g.fillRect(left + 20 + k * sw, y + pad, Math.ceil(sw), bandH - pad * 2 - 6)
    })
    y -= bandH + gap
  }
  // gestrichelter Platz für den nächsten Kasten
  g.setLineDash([18, 14])
  g.lineWidth = 5
  g.strokeStyle = 'rgba(255,255,255,.45)'
  roundRect(g, left, y, width, bandH, 12)
  g.stroke()
  g.setLineDash([])

  g.fillStyle = '#ffffff'
  g.font = '900 84px "Big Shoulders Display", Barlow, sans-serif'
  g.fillText('Plopp!', 90, H - 110)
  g.fillStyle = '#c9ccf2'
  g.font = '700 40px Barlow, sans-serif'
  g.textAlign = 'right'
  g.fillText(`seit ${p.since}`, W - 90, H - 120)
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'))
}

export async function shareTowerPoster(p: PosterInput): Promise<'shared' | 'saved' | 'failed'> {
  const blob = await drawTowerPoster(p)
  if (!blob) return 'failed'
  const file = new File([blob], 'plopp-turm.png', { type: 'image/png' })
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: p.title })
      return 'shared'
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'shared'
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plopp-turm.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'saved'
}
