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
import { IconBack, IconBrewery, IconFindAdd, IconMap, IconMore, IconMug } from './ui/icons'
import { haptic } from './ui/fx'
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
        <button className="title" onClick={() => go('/')} aria-label="Plopp! – zur Startseite">
          <span className="title-glass" aria-hidden="true">
            <span className="tg-foam" />
            <span className="tg-beer" />
          </span>
          Plopp!
        </button>
        <ChallengeButton active={active === 'challenge'} />
      </header>
      <ChallengeStrip hidden={active === 'challenge'} />
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
              if (active === path) window.scrollTo({ top: 0, behavior: 'smooth' })
              else go(`/${path}`)
            }}
          >
            <span className="icon">
              <Icon size={fab ? 28 : 23} />
            </span>
            <span className="label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

/** Knopf rechts oben: 🎯 – pulsiert, wenn der Abend läuft und keine Challenge gewählt ist; Ring = Fortschritt */
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
      <span className="ch-icon">🎯</span>
      {mode === 'choose' && <span className="ch-dot">!</span>}
    </button>
  )
}

/** Schmale Leiste unter dem Kopf, solange eine Challenge läuft */
function ChallengeStrip({ hidden }: { hidden: boolean }) {
  const st = useChallenges()
  if (hidden || !st.active || !st.night.open) return null
  const def = st.active && CHALLENGE_DEF(st.active.challenge)
  const p = st.progress
  return (
    <button className="ch-strip" onClick={() => go(def?.kind === 'quiz' ? '/quiz/challenge' : '/challenge')}>
      <span>{def?.icon ?? '🎯'}</span>
      <b>{def?.title ?? 'Challenge'}</b>
      {def?.kind === 'quiz' ? (
        <span className="ch-strip-prog">Quiz starten →</span>
      ) : p ? (
        <span className="ch-strip-prog">
          {p.unit ? `${p.cur}/${p.goal} ${p.unit}` : `${p.cur}/${p.goal}`}
        </span>
      ) : (
        <span className="ch-strip-prog">abhaken, wenn geschafft</span>
      )}
      <span className="ch-strip-time">noch {fmtLeft(st.night.end.getTime() - Date.now())}</span>
    </button>
  )
}
