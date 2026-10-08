import { Suspense, lazy, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { go, useRoute } from './router'
import { Spinner, Toaster } from './components'
import Login from './pages/Login'
import MyBeers from './pages/MyBeers'
import NewBeer from './pages/NewBeer'
import BeerDetail from './pages/BeerDetail'
import Breweries from './pages/Breweries'
import BreweryDetail from './pages/BreweryDetail'
import Catalog from './pages/Catalog'
import Settings from './pages/Settings'

// Kamera- und Kartenbibliotheken erst bei Bedarf laden
const Scan = lazy(() => import('./pages/Scan'))
const MapPage = lazy(() => import('./pages/MapPage'))

const NAV = [
  { path: '', icon: '🍺', label: 'Meine' },
  { path: 'scan', icon: '📷', label: 'Scannen' },
  { path: 'breweries', icon: '🏭', label: 'Brauereien' },
  { path: 'map', icon: '🗺️', label: 'Karte' },
  { path: 'settings', icon: '⚙️', label: 'Mehr' },
]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = useRoute()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Spinner />
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
    default:
      content = <MyBeers />
  }

  const active = page ?? ''
  const isSub = ['beer', 'brewery', 'new', 'catalog'].includes(active)

  return (
    <div className="app">
      <header className="topbar">
        {isSub ? (
          <button className="back" onClick={() => history.back()} aria-label="Zurück">
            ‹
          </button>
        ) : (
          <span className="back" />
        )}
        <span className="title">Bier-Tracker</span>
        <span className="back" />
      </header>
      <main>
        <Suspense fallback={<Spinner />}>{content}</Suspense>
      </main>
      <Toaster />
      <nav className="bottomnav">
        {NAV.map((n) => (
          <button key={n.path} className={active === n.path ? 'on' : ''} onClick={() => go(`/${n.path}`)}>
            <span className="icon">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
