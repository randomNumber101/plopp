import { Suspense, lazy, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { ensureCircle } from './api'
import { go, useRoute } from './router'
import { Celebration, Spinner, Toaster } from './components'
import { IconBack, IconBrewery, IconMap, IconMore, IconMug, IconScan } from './ui/icons'
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

const NAV = [
  { path: '', Icon: IconMug, label: 'Meine' },
  { path: 'breweries', Icon: IconBrewery, label: 'Brauereien' },
  { path: 'scan', Icon: IconScan, label: 'Scannen', fab: true },
  { path: 'map', Icon: IconMap, label: 'Karte' },
  { path: 'settings', Icon: IconMore, label: 'Mehr' },
]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = useRoute()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // ältere Konten ohne Runde bekommen beim ersten Start eine eigene
  const uid = session?.user.id
  useEffect(() => {
    if (uid) ensureCircle().catch(() => {})
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
    case 'invite':
      content = id ? <InviteWhileLoggedIn session={session} code={id} /> : <MyBeers />
      break
    default:
      content = <MyBeers />
  }

  const active = page ?? ''
  const isSub = ['beer', 'brewery', 'new', 'catalog', 'stats', 'invite', 'suggestions'].includes(active)
  const navActive = isSub ? (active === 'brewery' ? 'breweries' : active === 'catalog' || active === 'new' ? 'scan' : '') : active

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
        <span className="back" />
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
