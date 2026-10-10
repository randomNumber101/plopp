import { useMemo, useState } from 'react'
import { myCheckins, myWishlist, setWishlist } from '../api'
import { ACHIEVEMENTS, computeStats, progress, type BeerAgg } from '../achievements'
import {
  BeerRow,
  ChipBar,
  CountUp,
  EmptyState,
  ErrorBox,
  SearchInput,
  SkeletonList,
  Stars,
  dateBucket,
  relDate,
  toast,
  useAsync,
} from '../components'
import { go } from '../router'
import { usePageState } from '../pageState'
import { haptic, load, save } from '../ui/fx'
import { IconChevron, IconFindAdd, IconTrophy } from '../ui/icons'

type Sort = 'recent' | 'count' | 'rating' | 'name'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Zuletzt' },
  { id: 'count', label: 'Am häufigsten' },
  { id: 'rating', label: 'Beste' },
  { id: 'name', label: 'A–Z' },
]
const PREFS = 'bier-mybeers'

const HERO_BUBBLES = [8, 22, 37, 55, 68, 81, 93].map((left, i) => ({
  left,
  size: 4 + (i % 3) * 3,
  dur: 3 + (i % 4),
  delay: i * 0.7,
}))

export default function MyBeers() {
  const prefs = useMemo(() => load(PREFS, { tab: 'drunk', sort: 'recent', style: '' }), [])
  const [tab, setTabState] = useState<'drunk' | 'wish'>(prefs.tab as 'drunk' | 'wish')
  const [sort, setSortState] = useState<Sort>(prefs.sort as Sort)
  const [style, setStyleState] = useState(prefs.style)
  const [q, setQ] = usePageState('mybeers-q', '')
  const checkins = useAsync(myCheckins, [], 'my-checkins')
  const wish = useAsync(myWishlist, [], 'my-wishlist')

  const remember = (p: Partial<typeof prefs>) => save(PREFS, { tab, sort, style, ...p })
  const setTab = (t: 'drunk' | 'wish') => (setTabState(t), remember({ tab: t }))
  const setSort = (s: Sort) => (setSortState(s), remember({ sort: s }))
  const setStyle = (s: string) => (setStyleState(s), remember({ style: s }))

  const stats = useMemo(() => computeStats(checkins.data ?? []), [checkins.data])
  const badges = useMemo(() => ACHIEVEMENTS.filter((a) => progress(a, stats).done).length, [stats])

  const styles = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of stats.aggs) if (a.beer.style) m.set(a.beer.style, (m.get(a.beer.style) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [stats])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = stats.aggs.filter(
      (a) =>
        (!s || `${a.beer.name} ${a.beer.brewery?.name ?? ''} ${a.beer.style ?? ''}`.toLowerCase().includes(s)) &&
        (!style || a.beer.style === style),
    )
    const cmp: Record<Sort, (x: BeerAgg, y: BeerAgg) => number> = {
      recent: (x, y) => (x.last < y.last ? 1 : -1),
      count: (x, y) => y.count - x.count || (x.last < y.last ? 1 : -1),
      rating: (x, y) => (y.avg ?? -1) - (x.avg ?? -1) || y.count - x.count,
      name: (x, y) => x.beer.name.localeCompare(y.beer.name, 'de'),
    }
    return out.sort(cmp[sort])
  }, [stats, q, style, sort])

  const reload = () => {
    checkins.reload()
    wish.reload()
  }
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count))
  const wishCount = wish.data?.length ?? 0
  const loading = checkins.loading && !checkins.data

  return (
    <div className="page">
      {checkins.data && stats.checkins > 0 && (
        <button className="hero" onClick={() => go('/stats')} aria-label="Statistik und Abzeichen öffnen">
          {HERO_BUBBLES.map((b, i) => (
            <span
              key={i}
              className="hb"
              style={{ left: `${b.left}%`, width: b.size, height: b.size, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}
            />
          ))}
          <div className="hero-top">
            <div>
              <div className="hero-kicker">Deine Sammlung</div>
              <div className="hero-big">
                <CountUp value={stats.unique} />
                <small>{stats.unique === 1 ? 'Bier' : 'Biere'}</small>
              </div>
            </div>
            <span className="hero-badges">
              <IconTrophy size={18} /> {badges}/{ACHIEVEMENTS.length}
            </span>
          </div>
          <div className="hero-stats">
            <div>
              <b>
                <CountUp value={stats.thisMonth} />
              </b>
              <span>diesen Monat</span>
            </div>
            <div>
              <b>
                <CountUp value={stats.breweries} />
              </b>
              <span>Brauereien</span>
            </div>
            <div>
              <b>
                <CountUp value={stats.states.size} />
                /16
              </b>
              <span>Bundesländer</span>
            </div>
          </div>
          <div className="hero-spark" aria-hidden="true">
            {stats.months.map((m, i) => (
              <i
                key={m.key}
                className={i === stats.months.length - 1 ? 'cur' : ''}
                style={{ height: `${(m.count / maxMonth) * 100}%`, animationDelay: `${i * 35}ms` }}
              />
            ))}
          </div>
          <div className="hero-cta">
            <span>Statistik & Abzeichen</span>
            <IconChevron size={18} />
          </div>
        </button>
      )}

      <div className="tabs" style={{ '--i': tab === 'drunk' ? 0 : 1, '--n': 2 } as React.CSSProperties}>
        <span className="tabs-ind" />
        <button className={tab === 'drunk' ? 'on' : ''} onClick={() => setTab('drunk')}>
          Getrunken
        </button>
        <button className={tab === 'wish' ? 'on' : ''} onClick={() => setTab('wish')}>
          Merkliste {wishCount > 0 && <span className="tab-count">{wishCount}</span>}
        </button>
      </div>

      {tab === 'drunk' && (
        <>
          {stats.aggs.length > 0 && (
            <>
              <div className="toolbar">
                <SearchInput value={q} onChange={setQ} placeholder="Suchen …" />
                <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sortierung">
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              {styles.length > 1 && (
                <ChipBar
                  allowNone
                  value={style}
                  onChange={setStyle}
                  options={styles.map(([s, n]) => ({ id: s, label: s, count: n }))}
                />
              )}
            </>
          )}
          {loading && <SkeletonList />}
          <ErrorBox msg={checkins.error} />
          {checkins.data && stats.aggs.length === 0 && (
            <EmptyState title="Dein Glas ist noch leer">
              <p>Such dein erstes Bier – oder scanne den Barcode.</p>
              <button className="btn btn-primary btn-big" onClick={() => go('/catalog')}>
                <IconFindAdd size={22} /> Erstes Bier erfassen
              </button>
            </EmptyState>
          )}
          {checkins.data && stats.aggs.length > 0 && list.length === 0 && (
            <EmptyState icon="🔎" title="Nichts gefunden">
              <button className="btn" onClick={() => (setQ(''), setStyle(''))}>
                Filter zurücksetzen
              </button>
            </EmptyState>
          )}
          <Grouped list={list} grouped={sort === 'recent' && !q} onChanged={reload} />
        </>
      )}

      {tab === 'wish' && (
        <>
          {wish.loading && !wish.data && <SkeletonList rows={3} />}
          {wish.data?.length === 0 && (
            <EmptyState icon="⭐" title="Merkliste ist leer">
              <p>Tippe bei einem Bier auf „Merken“, dann landet es hier.</p>
            </EmptyState>
          )}
          <div className="list">
            {wish.data?.map((b, i) => (
              <BeerRow
                key={b.id}
                beer={b}
                index={i}
                quick
                onChanged={reload}
                right={
                  <button
                    className="badge wish"
                    aria-label="Von der Merkliste nehmen"
                    onClick={async (e) => {
                      e.stopPropagation()
                      haptic()
                      await setWishlist(b.id, false)
                      wish.setData((wish.data ?? []).filter((x) => x.id !== b.id))
                      toast({
                        icon: '☆',
                        msg: 'Von der Merkliste genommen',
                        action: { label: 'Rückgängig', run: async () => (await setWishlist(b.id, true), wish.reload()) },
                      })
                    }}
                  >
                    ★
                  </button>
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Grouped({ list, grouped, onChanged }: { list: BeerAgg[]; grouped: boolean; onChanged: () => void }) {
  const row = (a: BeerAgg, i: number) => (
    <BeerRow
      key={a.beer.id}
      beer={a.beer}
      index={i}
      quick
      onChanged={onChanged}
      sub={[a.beer.brewery?.name, a.beer.style, relDate(a.last)].filter(Boolean).join(' · ')}
      right={
        <>
          <span className="count">{a.count}×</span>
          {a.avg != null && <Stars value={Math.round(a.avg * 10) / 10} size="sm" />}
        </>
      }
    />
  )
  if (!grouped) return <div className="list">{list.map(row)}</div>
  const groups: [string, BeerAgg[]][] = []
  for (const a of list) {
    const g = dateBucket(a.last)
    if (!groups.length || groups[groups.length - 1][0] !== g) groups.push([g, []])
    groups[groups.length - 1][1].push(a)
  }
  let i = 0
  return (
    <>
      {groups.map(([g, items]) => (
        <section key={g} style={{ display: 'contents' }}>
          <div className="list-head">{g}</div>
          <div className="list">{items.map((a) => row(a, i++))}</div>
        </section>
      ))}
    </>
  )
}
