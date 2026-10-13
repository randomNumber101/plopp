import { Suspense, lazy, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { ensureCircle, resetSessionCaches } from './api'
import { clearPageState } from './pageState'
import { loadIndex } from './search'
import { resetQuiz } from './quiz'
import { byId as CHALLENGE_DEF, fmtLeft, resetChallenges, useChallenges } from './challenges'
import { go, useRoute } from './router'
import { Celebration, Spinner, Toaster } from './components'
import { IconBack, IconBrewery, IconFindAdd, IconMap, IconMoon, IconMore, IconMug } from './ui/icons'
import { haptic } from './ui/fx'
import PloppMark, { plopp } from './ui/PloppMark'
import { needsTiltPermission, nudge, requestTilt } from './ui/tilt'
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

const NAV = [
  { path: '', Icon: IconMug, label: 'Meine' },
  { path: 'breweries', Icon: IconBrewery, label: 'Brauereien' },
  { path: 'catalog', Icon: IconFindAdd, label: 'Erfassen', fab: true },
  { path: 'map', Icon: IconMap, label: 'Karte' },
  { path: 'settings', Icon: IconMore, label: 'Mehr' },
]

export default function App() {
  const [fizz, setFizz] = useState(0)
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = useRoute()

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
    case 'invite':
      content = id ? <InviteWhileLoggedIn session={session} code={id} /> : <MyBeers />
      break
    default:
      content = <MyBeers />
  }

  const active = page ?? ''
  const isSub = ['beer', 'brewery', 'new', 'scan', 'stats', 'invite', 'suggestions', 'katalog', 'challenge', 'quiz'].includes(active)
  const navActive = isSub
    ? active === 'brewery'
      ? 'breweries'
      : active === 'scan' || active === 'new'
        ? 'catalog'
        : ['stats', 'invite', 'suggestions', 'katalog'].includes(active)
          ? 'settings'
          : '-'
    : active

  return (
    <div className={`app ${active === 'map' ? 'app-map' : ''}`}>
      <header className="topbar">
        {isSub ? (
          <button className="back" onClick={() => history.back()} aria-label="Zurück">
            <IconBack size={22} />
          </button>
        ) : (
          <span className="back" />
        )}
        <div className="title-wrap">
          <button
            className="title"
            onClick={() => {
              // iOS fragt den Bewegungssensor nur nach einem Tipp ab
              if (needsTiltPermission()) void requestTilt()
              plopp()
              go('/')
            }}
            aria-label="Plopp! – zur Startseite"
          >
            <PloppMark size={32} />
            Plopp!
          </button>
          <ChallengeLine hidden={active === 'challenge'} />
        </div>
        <ChallengeButton active={active === 'challenge'} />
      </header>
      <main>
        <div className="page-anim" key={route.join('/')}>
          <Suspense fallback={<Spinner />}>{content}</Suspense>
        </div>
      </main>
      <Toaster />
      <Celebration />
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
              <Icon size={fab ? 28 : 23} />
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

/** Knopf rechts oben: Kronkorken mit Mond – pulsiert, wenn der Abend läuft und keine Challenge gewählt ist; Ring = Fortschritt */
function ChallengeButton({ active }: { active: boolean }) {
  const st = useChallenges()
  const p = st.progress
  const pct = st.active ? (p ? Math.min(1, p.cur / p.goal) : 0) : 0
  const mode = !st.night.open ? 'closed' : st.active ? 'running' : 'choose'
  return (
    <button
      className={`back ch-btn ch-${mode} ${active ? 'on' : ''}`}
      onClick={() => go('/challenge')}
      aria-label={
        mode === 'closed' ? 'Abend-Challenges (ab 16 Uhr)' : mode === 'choose' ? 'Abend-Challenge wählen' : 'Laufende Challenge'
      }
      style={{ '--p': `${pct * 100}%` } as React.CSSProperties}
    >
      <span className="ch-ring" />
      <span className="ch-cap" />
      <IconMoon size={20} className="ch-icon" />
      {mode === 'choose' && <span className="ch-dot">!</span>}
    </button>
  )
}

/** Laufende Challenge als kleine Zeile im Kopf unter „Plopp!“: Titel · Fortschritt · Restzeit */
function ChallengeLine({ hidden }: { hidden: boolean }) {
  const st = useChallenges()
  if (hidden || !st.active || !st.night.open) return null
  const def = CHALLENGE_DEF(st.active.challenge)
  const p = st.progress
  const prog = def?.kind === 'quiz' ? 'Quiz starten' : p ? `${p.cur}/${p.goal}` : 'abhaken'
  const mins = Math.max(0, Math.round((st.night.end.getTime() - Date.now()) / 60000))
  const left = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} h`
  return (
    <button
      className="ch-line"
      onClick={() => go(def?.kind === 'quiz' ? '/quiz/challenge' : '/challenge')}
      aria-label={`Laufende Challenge: ${def?.title ?? 'Challenge'}, ${prog}, noch ${fmtLeft(st.night.end.getTime() - Date.now())}`}
    >
      <span className="ch-line-title">{def?.title ?? 'Challenge'}</span>
      <b>{prog}</b>
      <span className="ch-line-time">noch {left}</span>
    </button>
  )
}
