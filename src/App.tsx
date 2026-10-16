import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { ensureCircle, resetSessionCaches } from './api'
import { clearPageState } from './pageState'
import { loadIndex } from './search'
import { resetQuiz } from './quiz'
import { byId as CHALLENGE_DEF, fmtLeft, resetChallenges, useChallenges } from './challenges'
import { go, useRoute } from './router'
import { Celebration, Spinner, Toaster } from './components'
import { IconBack, IconBrewery, IconCrate, IconMap, IconMore, IconPlus } from './ui/icons'
import { haptic } from './ui/fx'
import PloppMark, { plopp } from './ui/PloppMark'
import { nudge } from './ui/tilt'
import Login from './pages/Login'
import MyBeers from './pages/MyBeers'
import NewBeer from './pages/NewBeer'
import BeerDetail from './pages/BeerDetail'
import Breweries from './pages/Breweries'
import BreweryDetail from './pages/BreweryDetail'
import Catalog from './pages/Catalog'
import Settings from './pages/Settings'
import { InviteWhileLoggedIn } from './pages/Invites'

// Kamera- und Kartenbibliotheken erst bei Bedarf laden
const Scan = lazy(() => import('./pages/Scan'))
const MapPage = lazy(() => import('./pages/MapPage'))
const Stats = lazy(() => import('./pages/Stats'))
const Suggestions = lazy(() => import('./pages/Suggestions'))
const CatalogAdmin = lazy(() => import('./pages/CatalogAdmin'))
const ChallengePage = lazy(() => import('./pages/Challenge'))
const QuizPage = lazy(() => import('./pages/Quiz'))
const BadgesPage = lazy(() => import('./pages/Badges'))

const NAV = [
  { path: '', Icon: IconCrate, label: 'Meine' },
  { path: 'breweries', Icon: IconBrewery, label: 'Brauereien' },
  { path: 'catalog', Icon: IconPlus, label: 'Erfassen', fab: true },
  { path: 'map', Icon: IconMap, label: 'Karte' },
  { path: 'settings', Icon: IconMore, label: 'Mehr' },
]

/** Höhe des Kopfs (mit Rummel-Banner) als CSS-Variable --head-h – die Karte hängt sich darunter */
function useHeadHeight(ready: boolean) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--head-h', `${el.getBoundingClientRect().height}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])
  return ref
}

/** Farbe der Browser-/Statusleiste: wie der Kopf (hell/dunkel), auf dem Rummel nachtblau */
function useThemeColor(rummel: boolean) {
  useEffect(() => {
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
    for (const m of metas) {
      m.dataset.base ??= m.content
      m.content = rummel ? '#1b1f4a' : m.dataset.base
    }
  }, [rummel])
}

export default function App() {
  const [fizz, setFizz] = useState(0)
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const headRef = useHeadHeight(!!session)
  const route = useRoute()
  useThemeColor(route[0] === 'challenge' || route[0] === 'quiz')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    let lastUid: string | undefined
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      // anderes Konto (oder abgemeldet) → gemerkte Listen & Filter verwerfen
      const uid = s?.user.id
      if (lastUid !== undefined && uid !== lastUid) {
        clearPageState()
        resetSessionCaches()
        resetChallenges()
        resetQuiz()
      }
      lastUid = uid ?? ''
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // ältere Konten ohne Runde bekommen beim ersten Start eine eigene
  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    ensureCircle().catch(() => {})
    // Suchindex schon vorab laden, damit „Erfassen“ sofort Treffer liefert
    const t = setTimeout(() => loadIndex().catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [uid])

  if (session === undefined) return <div className="boot"><Spinner /></div>
  if (!session) return <Login />

  const [page, id] = route
  let content: React.ReactNode
  switch (page) {
    case undefined:
      content = <MyBeers />
      break
    case 'scan':
      content = <Scan />
      break
    case 'new':
      content = <NewBeer key={route.join('/')} />
      break
    case 'beer':
      content = <BeerDetail key={id} id={id} />
      break
    case 'breweries':
      content = <Breweries />
      break
    case 'brewery':
      content = <BreweryDetail key={id} id={id} />
      break
    case 'catalog':
      content = <Catalog />
      break
    case 'map':
      content = <MapPage />
      break
    case 'settings':
      content = <Settings session={session} />
      break
    case 'stats':
      content = <Stats />
      break
    case 'suggestions':
      content = <Suggestions />
      break
    case 'katalog':
      content = <CatalogAdmin />
      break
    case 'challenge':
      content = <ChallengePage />
      break
    case 'quiz':
      content = <QuizPage key={route.join('/')} mode={id === 'challenge' ? 'challenge' : 'free'} />
      break
    case 'abzeichen':
      content = <BadgesPage />
      break
    case 'invite':
      content = id ? <InviteWhileLoggedIn session={session} code={id} /> : <MyBeers />
      break
    default:
      content = <MyBeers />
  }

  const active = page ?? ''
  const rummel = active === 'challenge' || active === 'quiz'
  const isSub = ['beer', 'brewery', 'new', 'scan', 'stats', 'abzeichen', 'invite', 'suggestions', 'katalog', 'challenge', 'quiz'].includes(active)
  const navActive = isSub
    ? active === 'brewery'
      ? 'breweries'
      : active === 'scan' || active === 'new'
        ? 'catalog'
        : ['stats', 'abzeichen', 'invite', 'suggestions', 'katalog'].includes(active)
          ? 'settings'
          : '-'
    : active

  return (
    <div className={`app ${active === 'map' ? 'app-map' : ''} ${rummel ? 'app-rummel' : ''}`}>
      <header className="topbar" ref={headRef}>
        <div className="topbar-row">
          {isSub && (
            <button className="back" onClick={() => history.back()} aria-label="Zurück">
              <IconBack size={22} />
            </button>
          )}
          <div className="title-wrap">
            <button
              className="title"
              onClick={() => {
                plopp()
                go('/')
              }}
              aria-label="Plopp! – zur Startseite"
            >
              <PloppMark size={34} />
              Plopp!
            </button>
          </div>
          <LosButton active={active === 'challenge'} />
        </div>
        <RummelBanner hidden={active === 'challenge' || active === 'quiz'} />
      </header>
      <main>
        <div className="page-anim" key={route.join('/')}>
          <Suspense fallback={<Spinner />}>{content}</Suspense>
        </div>
      </main>
      <Toaster />
      <Celebration />
      <RummelIntro />
      <nav className="bottomnav">
        {NAV.map(({ path, Icon, label, fab }) => (
          <button
            key={path}
            className={`${navActive === path ? 'on' : ''} ${fab ? 'fab' : ''}`}
            aria-current={navActive === path ? 'page' : undefined}
            onClick={() => {
              haptic(6)
              if (fab) setFizz((n) => n + 1)
              else nudge(4)
              if (active === path) window.scrollTo({ top: 0, behavior: 'smooth' })
              else go(`/${path}`)
            }}
          >
            <span className="icon">
              <Icon size={fab ? 30 : 24} strokeWidth={fab ? 3 : 2} />
              {fab && fizz > 0 && (
                <span className="fab-fizz" key={fizz} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </span>
            <span className="label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

/** Los-Knopf rechts oben: roter Lose-Schein. Wackelt ab und zu, solange abends noch keine Challenge läuft;
 *  läuft eine, zeigt er den Fortschritt. Vor 16 Uhr ruhig in Nachtblau. */
function LosButton({ active }: { active: boolean }) {
  const st = useChallenges()
  const p = st.progress
  const mode = !st.night.open ? 'closed' : st.active ? 'running' : 'choose'
  const def = st.active ? CHALLENGE_DEF(st.active.challenge) : undefined
  const label = mode === 'running' ? (def?.kind === 'quiz' ? 'Quiz' : p ? `${p.cur}/${p.goal}` : 'Los') : 'Los'
  return (
    <button
      className={`los-btn ${mode} ${active ? 'on' : ''}`}
      onClick={() => go('/challenge')}
      aria-label={mode === 'closed' ? 'Abend-Challenges (ab 16 Uhr)' : mode === 'choose' ? 'Abend-Challenge wählen' : 'Laufende Challenge'}
    >
      <span className={`bulb ${mode === 'closed' ? 'off' : 'chase'}`} />
      {label}
    </button>
  )
}

const KIND_COLOR = { auto: '#1f4e8c', manual: '#c8102e', quiz: '#6d3fa0' } as const

/** Laufende Challenge als Rummel-Banner unter dem Kopf: Titel, Restzeit, Glühbirnen als Fortschritt */
function RummelBanner({ hidden }: { hidden: boolean }) {
  const st = useChallenges()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  if (hidden || !st.active || !st.night.open) return null
  const def = CHALLENGE_DEF(st.active.challenge)
  const p = st.progress
  const left = fmtLeft(st.night.end.getTime() - Date.now())
  const goal = p ? Math.min(p.goal, 8) : 0
  return (
    <button
      className="rummel-banner"
      onClick={() => go(def?.kind === 'quiz' ? '/quiz/challenge' : '/challenge')}
      aria-label={`Laufende Challenge: ${def?.title ?? 'Challenge'}, ${p ? `${p.cur} von ${p.goal}` : ''}, noch ${left}`}
    >
      <span className="bulb-row bulbs-chase" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} className="bulb" />
        ))}
      </span>
      <span className="rb-main">
        <span className="rb-mark" style={{ background: def ? KIND_COLOR[def.kind] : '#1f4e8c' }} aria-hidden="true">
          {def?.icon ?? '🎯'}
        </span>
        <span className="rb-text">
          <span className="rb-title">{def?.title ?? 'Challenge'}</span>
          <span className="rb-time">noch {left}</span>
        </span>
        <span className="rb-prog" aria-hidden="true">
          {def?.kind === 'quiz' || !p ? (
            'Quiz'
          ) : p.goal <= 8 ? (
            Array.from({ length: goal }, (_, i) => <span key={i} className={`bulb ${i < p.cur ? 'lit' : 'off'}`} />)
          ) : (
            `${p.cur}/${p.goal}`
          )}
        </span>
      </span>
    </button>
  )
}

/** Rummel-Vorhang beim Start einer Challenge (startRummel): Markise, Lichter, Titel – klappt dann zum Banner zusammen */
function RummelIntro() {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    let t = 0
    const on = (e: Event) => {
      setId((e as CustomEvent<string>).detail)
      window.clearTimeout(t)
      t = window.setTimeout(() => setId(null), 2300)
    }
    window.addEventListener('rummel-start', on)
    return () => {
      window.removeEventListener('rummel-start', on)
      window.clearTimeout(t)
    }
  }, [])
  if (!id) return null
  const def = CHALLENGE_DEF(id)
  return (
    <div className="rummel-intro" role="status" aria-live="polite" onClick={() => setId(null)}>
      <div className="ri-awning" aria-hidden="true" />
      <div className="bulb-row bulbs-chase" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="bulb" />
        ))}
      </div>
      <div className="ri-mark" style={{ background: def ? KIND_COLOR[def.kind] : '#1f4e8c' }} aria-hidden="true">
        {def?.icon ?? '🎯'}
      </div>
      <div className="ri-title">{def?.title ?? 'Los geht’s'}</div>
      {def?.desc && <div className="ri-desc">{def.desc}</div>}
      <div className="ri-until">bis 4 Uhr</div>
    </div>
  )
}
