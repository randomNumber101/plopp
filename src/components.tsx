import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Beer, Trust } from './types'
import { go } from './router'
import { addCheckin, deleteCheckin } from './api'
import { checkNewAchievements } from './achievements'
import { celebrate, haptic, reducedMotion, type CelebrateOpts } from './ui/fx'
import { IconCheck, IconSearch, IconX } from './ui/icons'

/** Lädt Daten asynchron; reload() lädt neu (ohne die alten Daten vorher zu verwerfen) */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  useEffect(() => {
    let alive = true
    setLoading(true)
    run()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [run, tick])
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData }
}

// ---------------------------------------------------------------------------------------------- Toast
export interface ToastOpts {
  msg: string
  icon?: string
  action?: { label: string; run: () => void | Promise<void> }
  duration?: number
}

/** Kurze Rückmeldung unten am Bildschirm – optional mit Knopf (z. B. „Rückgängig“) */
export function toast(o: string | ToastOpts) {
  window.dispatchEvent(new CustomEvent('bier-toast', { detail: typeof o === 'string' ? { msg: o } : o }))
}

export function Toaster() {
  const [t, setT] = useState<(ToastOpts & { id: number }) | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const on = (e: Event) => {
      const o = (e as CustomEvent<ToastOpts>).detail
      const id = Date.now()
      setT({ ...o, id })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setT((cur) => (cur?.id === id ? null : cur)), o.duration ?? (o.action ? 5000 : 2600))
    }
    window.addEventListener('bier-toast', on)
    return () => {
      window.removeEventListener('bier-toast', on)
      clearTimeout(timer.current)
    }
  }, [])
  if (!t) return null
  const dur = t.duration ?? (t.action ? 5000 : 2600)
  return (
    <div className="toast" role="status" key={t.id}>
      {t.icon && <span className="toast-icon">{t.icon}</span>}
      <span className="toast-msg">{t.msg}</span>
      {t.action && (
        <button
          className="toast-action"
          onClick={async () => {
            setT(null)
            haptic()
            await t.action!.run()
          }}
        >
          {t.action.label}
        </button>
      )}
      <span className="toast-timer" style={{ animationDuration: `${dur}ms` }} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Feier
const BUBBLES = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  size: 8 + ((i * 13) % 22),
  delay: ((i * 7) % 10) / 14,
  dur: 1.1 + ((i * 5) % 7) / 10,
}))
const CONFETTI = Array.from({ length: 34 }, (_, i) => ({
  left: (i * 29) % 100,
  delay: ((i * 11) % 10) / 20,
  rot: (i * 47) % 360,
  hue: [38, 140, 4, 205, 48, 280][i % 6],
}))

export function Celebration() {
  const [c, setC] = useState<(CelebrateOpts & { id: number }) | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const on = (e: Event) => {
      const o = (e as CustomEvent<CelebrateOpts>).detail
      const id = Date.now()
      setC({ ...o, id })
      haptic(o.kind === 'badge' ? 60 : 25)
      clearTimeout(t)
      t = setTimeout(() => setC((cur) => (cur?.id === id ? null : cur)), o.kind === 'badge' ? 3200 : 1500)
    }
    window.addEventListener('bier-celebrate', on)
    return () => {
      window.removeEventListener('bier-celebrate', on)
      clearTimeout(t)
    }
  }, [])
  if (!c) return null
  const motion = !reducedMotion()
  return (
    <div className={`celebrate celebrate-${c.kind ?? 'prost'}`} key={c.id} onClick={() => setC(null)} aria-live="polite">
      {motion &&
        BUBBLES.map((b, i) => (
          <span
            key={i}
            className="bubble"
            style={{ left: `${b.left}%`, width: b.size, height: b.size, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }}
          />
        ))}
      {motion &&
        c.kind === 'badge' &&
        CONFETTI.map((p, i) => (
          <span
            key={`c${i}`}
            className="confetti"
            style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: `hsl(${p.hue} 85% 55%)`, rotate: `${p.rot}deg` }}
          />
        ))}
      <div className="celebrate-card">
        <div className="celebrate-icon">{c.icon ?? '🍻'}</div>
        {c.kind === 'badge' && <div className="celebrate-kicker">Abzeichen freigeschaltet!</div>}
        <div className="celebrate-title">{c.title}</div>
        {c.sub && <div className="celebrate-sub">{c.sub}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Check-in
const PROST = ['Prost!', 'Zum Wohl!', 'Cheers!', 'Na denn Prost!', "O'zapft is!", 'Wohl bekomm’s!']
export const prostWord = () => PROST[Math.floor(Math.random() * PROST.length)]

/** Sofort eintragen, mit „Rückgängig“ im Toast; prüft danach auf neue Abzeichen */
export async function quickCheckin(beer: Pick<Beer, 'id' | 'name'>, opts: { big?: boolean; onUndo?: () => void } = {}) {
  haptic(20)
  const id = await addCheckin(beer.id)
  if (opts.big) celebrate({ kind: 'prost', title: prostWord(), sub: beer.name })
  toast({
    icon: '🍻',
    msg: opts.big ? 'Eingetragen' : `${prostWord()} ${beer.name}`,
    action: {
      label: 'Rückgängig',
      run: async () => {
        await deleteCheckin(id)
        toast({ icon: '↩️', msg: 'Rückgängig gemacht' })
        opts.onUndo?.()
      },
    },
  })
  checkNewAchievements()
  return id
}

/** Kleiner „+1“-Knopf für Listen: trägt das Bier sofort ein */
export function ProstButton({
  beer,
  onDone,
  label,
}: {
  beer: Pick<Beer, 'id' | 'name'>
  onDone?: () => void
  label?: string
}) {
  const [st, setSt] = useState<'idle' | 'busy' | 'done'>('idle')
  return (
    <button
      type="button"
      className={`prost-btn ${st}`}
      aria-label={`${beer.name} jetzt eintragen`}
      title="Jetzt getrunken"
      disabled={st === 'busy'}
      onClick={async (e) => {
        e.stopPropagation()
        setSt('busy')
        try {
          await quickCheckin(beer, { onUndo: onDone })
          setSt('done')
          onDone?.()
          setTimeout(() => setSt('idle'), 1600)
        } catch (err) {
          setSt('idle')
          toast({ icon: '⚠️', msg: (err as Error).message })
        }
      }}
    >
      <span className="prost-fill" />
      <span className="prost-label">{st === 'done' ? <IconCheck size={18} /> : (label ?? '+1')}</span>
      {st === 'done' && (
        <span className="prost-pop" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ '--a': `${i * 60}deg` } as React.CSSProperties} />
          ))}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------- Datum
/** yyyy-mm-dd für <input type="date"> (lokale Zeit) */
export function todayInput() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

/** Datum aus <input type="date"> → ISO-Zeitpunkt; heute = jetzt, sonst 20:00 Uhr */
export function dateInputToIso(v: string) {
  if (!v || v === todayInput()) return new Date().toISOString()
  return new Date(`${v}T20:00:00`).toISOString()
}

export function isoToDateInput(iso: string) {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** „heute“, „gestern“, „vor 3 Tagen“, „12. Mär.“ */
export function relDate(iso: string) {
  const d = new Date(iso)
  const days = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000)
  if (days <= 0) return 'heute'
  if (days === 1) return 'gestern'
  if (days < 7) return `vor ${days} Tagen`
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** Gruppen für Listen: Heute, Diese Woche, Diesen Monat, Früher */
export function dateBucket(iso: string) {
  const days = Math.round((dayStart(new Date()) - dayStart(new Date(iso))) / 86400000)
  if (days <= 0) return 'Heute'
  if (days < 7) return 'Diese Woche'
  if (days < 31) return 'Diesen Monat'
  return 'Früher'
}

// ---------------------------------------------------------------------------------------------- Kleinteile
/** Bierglas, das sich füllt – statt eines Drehkreises */
export function Spinner({ label = 'Lädt' }: { label?: string }) {
  return (
    <div className="loader" aria-label={label} role="status">
      <svg viewBox="0 0 40 48" width="40" height="48">
        <defs>
          <clipPath id="glass-clip">
            <path d="M8 6h20l-2 36a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3L8 6Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#glass-clip)">
          <rect className="loader-beer" x="0" y="0" width="40" height="48" />
          <rect className="loader-foam" x="0" y="0" width="40" height="6" />
        </g>
        <path className="loader-glass" d="M8 6h20l-2 36a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3L8 6Z" />
        <path className="loader-glass" d="M28 14h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5" />
      </svg>
    </div>
  )
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="error">⚠️ {msg}</div>
}

/** Sterne – zeigt auch Zwischenwerte (z. B. 3,7 = drei volle Sterne und 70 % vom vierten) */
export function Stars({
  value,
  onChange,
  size = 'md',
}: {
  value: number | null
  onChange?: (v: number | null) => void
  size?: 'sm' | 'md' | 'lg'
}) {
  const [popped, setPopped] = useState<number | null>(null)
  return (
    <span
      className={`stars stars-${size}`}
      role={onChange ? 'radiogroup' : 'img'}
      aria-label={value != null ? `${formatRating(value)} von 5 Sternen` : 'nicht bewertet'}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value == null ? 0 : Math.max(0, Math.min(1, value - (n - 1)))
        return (
          <button
            key={n}
            type="button"
            disabled={!onChange}
            className={`${fill >= 1 ? 'on' : ''} ${popped != null && n <= popped ? 'pop' : ''}`}
            style={{ animationDelay: `${(n - 1) * 40}ms` }}
            onClick={() => {
              const v = value === n ? null : n
              setPopped(v)
              haptic(8)
              setTimeout(() => setPopped(null), 450)
              onChange?.(v)
            }}
            aria-label={`${n} Sterne`}
          >
            ★{fill > 0 && fill < 1 && <span className="star-part" style={{ width: `${fill * 100}%` }}>★</span>}
          </button>
        )
      })}
    </span>
  )
}

/** 4,3 statt 4.3 – ganze Zahlen ohne Komma */
export function formatRating(v: number) {
  return Number.isInteger(v) ? String(v) : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

const RATING_WORDS: [number, string][] = [
  [1.5, 'Naja …'],
  [2.5, 'Geht so'],
  [3.3, 'Ordentlich'],
  [3.9, 'Gut'],
  [4.4, 'Sehr gut!'],
  [4.8, 'Richtig stark! 🔥'],
  [5.01, 'Hammer! 🤩'],
]
export const ratingWord = (v: number) => RATING_WORDS.find(([max]) => v < max)?.[1] ?? ''

/** Bewertung mit Sternen (ganze Sterne antippen) und Regler für Zwischenwerte in Zehnteln */
export function RatingInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const v = value ?? 0
  return (
    <div className="rating-input">
      <Stars value={value} onChange={onChange} size="lg" />
      <div className="rating-row">
        <input
          type="range"
          min={0.5}
          max={5}
          step={0.1}
          value={value ?? 3}
          className={value == null ? 'unset' : ''}
          style={{ '--p': `${(((value ?? 3) - 0.5) / 4.5) * 100}%` } as React.CSSProperties}
          aria-label="Bewertung feinjustieren"
          onChange={(e) => {
            const n = Math.round(Number(e.target.value) * 10) / 10
            if (Math.round(n * 2) !== Math.round(v * 2)) haptic(4)
            onChange(n)
          }}
        />
        <span className="rating-num">{value != null ? formatRating(value) : '–'}</span>
      </div>
      <div className="rate-label">{value != null ? ratingWord(value) : 'Sterne antippen oder Regler schieben'}</div>
    </div>
  )
}

export function BeerThumb({ beer }: { beer: Beer }) {
  const [broken, setBroken] = useState(false)
  const src = beer.image_url || beer.brewery?.logo_url
  return src && !broken ? (
    <img
      className={`thumb ${beer.image_url ? '' : 'thumb-logo'}`}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <div className="thumb thumb-empty">🍺</div>
  )
}

export const TRUST: Record<Trust, { label: string; icon: string; title: string }> = {
  verified: { label: 'Geprüft', icon: '✓', title: 'Geprüft: steht in der Wikipedia-Liste bzw. stammt von der Brauerei' },
  unverified: { label: 'Ungeprüft', icon: '?', title: 'Automatisch zugeordnet (Open Food Facts / Wikidata / OpenStreetMap) – nicht sicher' },
  user: { label: 'Eigener Eintrag', icon: '✎', title: 'Von dir angelegt' },
}

/** Kleiner farbiger Punkt vor Namen: grün = geprüft, gestrichelt = ungeprüft, blau = eigener Eintrag */
export function TrustDot({ trust }: { trust?: Trust | null }) {
  const t = trust ?? 'user'
  return <span className={`trust-dot t-${t}`} title={TRUST[t].title} aria-label={TRUST[t].label} />
}

/** Markiert Einträge, die nur in der eigenen Runde existieren bzw. dort geändert wurden */
export function RoundChip({ item }: { item: { circle_id?: string | null; _edited?: boolean } }) {
  if (item.circle_id)
    return (
      <span className="round-chip" title="Von deiner Runde angelegt – als Vorschlag für den Katalog gespeichert">
        👥 nur in deiner Runde
      </span>
    )
  if (item._edited)
    return (
      <span className="round-chip" title="Deine Runde hat Angaben geändert – als Vorschlag für den Katalog gespeichert">
        ✏️ in deiner Runde geändert
      </span>
    )
  return null
}

/** Hinweis unter Bearbeiten-Formularen */
export function RoundNote() {
  return (
    <p className="round-note">
      👥 Änderungen gelten sofort für dich und deine Runde (eingeladene Freunde). Für den gemeinsamen Katalog werden sie als{' '}
      <button type="button" className="link" onClick={() => go('/suggestions')}>
        Vorschlag
      </button>{' '}
      gespeichert und geprüft.
    </p>
  )
}

export function TrustBadge({ trust, detail }: { trust?: Trust | null; detail?: string }) {
  const t = trust ?? 'user'
  return (
    <span className={`trust-badge t-${t}`} title={TRUST[t].title}>
      {TRUST[t].icon} {TRUST[t].label}
      {detail ? <span className="trust-detail"> · {detail}</span> : null}
    </span>
  )
}

export function TrustLegend() {
  return (
    <div className="trust-legend">
      <span>
        <TrustDot trust="verified" /> geprüft
      </span>
      <span>
        <TrustDot trust="unverified" /> ungeprüft
      </span>
      <span>
        <TrustDot trust="user" /> eigener Eintrag
      </span>
    </div>
  )
}

/** Listenzeile eines Biers. quick = „+1“-Knopf zum sofortigen Eintragen */
export function BeerRow({
  beer,
  right,
  sub,
  index = 0,
  quick,
  onChanged,
  title,
  selected,
  onSelect,
  onLongPress,
}: {
  beer: Beer
  right?: React.ReactNode
  sub?: React.ReactNode
  index?: number
  quick?: boolean
  onChanged?: () => void
  /** abweichender Anzeigename (z. B. ohne Brauereinamen) */
  title?: string
  /** Auswahlmodus: Tippen wählt aus statt zu öffnen */
  selected?: boolean
  onSelect?: () => void
  /** langes Drücken (z. B. um den Auswahlmodus zu starten) */
  onLongPress?: () => void
}) {
  const selecting = onSelect !== undefined
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null)
  const open = () => {
    if (press.current?.fired) return
    if (selecting) {
      haptic(6)
      onSelect!()
    } else go(`/beer/${beer.id}`)
  }
  const cancel = () => press.current && clearTimeout(press.current.t)
  return (
    <div
      role={selecting ? 'checkbox' : 'button'}
      aria-checked={selecting ? !!selected : undefined}
      tabIndex={0}
      className={`row ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
      onPointerDown={(e) => {
        if (!onLongPress || selecting) return
        cancel()
        const st = { x: e.clientX, y: e.clientY, fired: false, t: setTimeout(() => {
          st.fired = true
          haptic(30)
          onLongPress()
        }, 520) }
        press.current = st
      }}
      onPointerMove={(e) => {
        const p = press.current
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => onLongPress && e.preventDefault()}
      onClick={() => {
        open()
        if (press.current) press.current.fired = false
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
    >
      {selecting && (
        <span className="select-box" aria-hidden="true">
          {selected && <IconCheck size={16} />}
        </span>
      )}
      <BeerThumb beer={beer} />
      <div className="row-main">
        <div className="row-title" title={title && title !== beer.name ? beer.name : undefined}>
          <TrustDot trust={beer.trust} />
          {title ?? beer.name}
        </div>
        <div className="row-sub">
          {sub ??
            [beer.brewery?.name, beer.style, beer.abv != null ? `${beer.abv} %` : null].filter(Boolean).join(' · ')}
        </div>
      </div>
      {right && !selecting && <div className="row-right">{right}</div>}
      {quick && !selecting && <ProstButton beer={beer} onDone={onChanged} />}
    </div>
  )
}

/** Unten einfahrendes Auswahlblatt (z. B. Grund fürs Ausblenden) */
export function ChoiceSheet<T extends string>({
  title,
  sub,
  options,
  onPick,
  onClose,
}: {
  title: string
  sub?: string
  options: { id: T; label: string; icon?: string }[]
  onPick: (id: T) => void
  onClose: () => void
}) {
  return createPortal(
    <div className="choice-backdrop" onClick={onClose}>
      <div className="choice-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <b className="choice-title">{title}</b>
        {sub && <p className="muted small choice-sub">{sub}</p>}
        <div className="menu">
          {options.map((o) => (
            <button key={o.id} onClick={() => onPick(o.id)}>
              {o.icon && <span className="m-icon">{o.icon}</span>}
              <span className="m-main">{o.label}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Am unteren Rand schwebende Leiste (außerhalb der Seite gerendert, damit sie immer oben liegt) */
export function FloatingBar({ children }: { children: React.ReactNode }) {
  return createPortal(<div className="action-bar">{children}</div>, document.body)
}

/** Fortschritt als sich füllendes Bierglas (Balken mit Schaumkrone) */
export function Progress({ drunk, total, wide }: { drunk: number; total: number; wide?: boolean }) {
  const pct = total ? Math.round((drunk / total) * 100) : 0
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(t)
  }, [pct])
  return (
    <div className={`progress ${wide ? 'progress-wide' : ''} ${pct >= 100 ? 'full' : ''}`} title={`${drunk} von ${total}`}>
      <div className="progress-bar" style={{ width: `${shown}%` }} />
      <span>
        {drunk}/{total}
      </span>
    </div>
  )
}

/** Suchfeld mit Lupe und Löschen-Knopf */
export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  onSubmit?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <form
      className="searchbox"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        ref.current?.blur()
        onSubmit?.()
      }}
    >
      <IconSearch size={18} className="searchbox-icon" />
      <input
        ref={ref}
        className="search"
        type="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="searchbox-clear"
          aria-label="Suche leeren"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
        >
          <IconX size={16} />
        </button>
      )}
    </form>
  )
}

/** Horizontale Auswahl-Chips */
export function ChipBar<T extends string>({
  options,
  value,
  onChange,
  allowNone,
}: {
  options: { id: T; label: React.ReactNode; count?: number }[]
  value: T | ''
  onChange: (v: T | '') => void
  allowNone?: boolean
}) {
  return (
    <div className="chips chipbar">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`chip-btn ${value === o.id ? 'on' : ''}`}
          onClick={() => {
            haptic(6)
            onChange(allowNone && value === o.id ? '' : o.id)
          }}
        >
          {o.label}
          {o.count != null && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="list skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="row" key={i}>
          <div className="thumb sk" />
          <div className="row-main">
            <div className="sk sk-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
            <div className="sk sk-line sk-sub" style={{ width: `${35 + ((i * 23) % 30)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Leerer Zustand mit kleinem Bierglas */
export function EmptyState({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: string }) {
  return (
    <div className="empty">
      {icon ? (
        <div className="empty-emoji">{icon}</div>
      ) : (
        <svg className="empty-glass" viewBox="0 0 64 72" width="72" height="80" aria-hidden="true">
          <path d="M14 14h30l-3 50a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4L14 14Z" className="eg-glass" />
          <path d="M44 24h6a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5h-8" className="eg-glass" />
          <path d="M16 40h26l-1.6 24a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3Z" className="eg-beer" />
          <circle cx="24" cy="54" r="1.6" className="eg-bubble" />
          <circle cx="32" cy="48" r="1.2" className="eg-bubble" style={{ animationDelay: '.6s' }} />
          <circle cx="36" cy="58" r="1.4" className="eg-bubble" style={{ animationDelay: '1.1s' }} />
        </svg>
      )}
      <b>{title}</b>
      {children}
    </div>
  )
}

/** Zahl, die beim Erscheinen hochzählt */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [v, setV] = useState(reducedMotion() ? value : 0)
  useEffect(() => {
    if (reducedMotion()) return setV(value)
    let raf = 0
    const start = performance.now()
    const from = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700)
      const e = 1 - Math.pow(1 - k, 3)
      setV(from + (value - from) * e)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{v.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>
}
