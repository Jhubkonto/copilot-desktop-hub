import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Search, Star, X } from 'lucide-react'
import type { ConversationRatingListItem, ConversationRatingStats, RatingAggregate, RatingTrendPoint } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'

const EMPTY_STATS: ConversationRatingStats = {
  averageByAgent: [], averageByModel: [], averageBySkill: [], averageByServer: [], averageByProject: [], trend: [],
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500 shrink-0" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`w-3 h-3 ${n <= rating ? 'fill-current' : 'text-gray-300 dark:text-gray-600'}`} />
      ))}
    </span>
  )
}

function useChartColors() {
  const theme = useAppStore((s) => s.theme)
  const dark = theme === 'dark'
  return {
    bar: dark ? '#60a5fa' : '#2563eb',
    grid: dark ? '#374151' : '#e5e7eb',
    axis: dark ? '#9ca3af' : '#6b7280',
  }
}

function RatingBarChart({ title, data }: { title: string; data: RatingAggregate[] }) {
  const { bar, grid, axis } = useChartColors()
  if (data.length === 0) return null
  const top = data.slice(0, 8)
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{title}</p>
      <ResponsiveContainer width="100%" height={Math.max(56, top.length * 26)}>
        <BarChart data={top} layout="vertical" margin={{ top: 2, right: 20, bottom: 2, left: 2 }}>
          <CartesianGrid horizontal={false} stroke={grid} />
          <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 10, fill: axis }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={84}
            tick={{ fontSize: 10, fill: axis }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: grid, opacity: 0.3 }}
            formatter={(value, _name, item) => [
              `${Number(value).toFixed(1)} / 5 (${(item.payload as RatingAggregate).count} rated)`,
              'Average',
            ]}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
          <Bar dataKey="average" fill={bar} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function RatingTrendChart({ data }: { data: RatingTrendPoint[] }) {
  const { bar, grid, axis } = useChartColors()
  if (data.length === 0) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Rating Trend</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
          <CartesianGrid vertical={false} stroke={grid} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: axis }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: axis }} axisLine={false} tickLine={false} width={24} />
          <Tooltip
            formatter={(value, _name, item) => [
              `${Number(value).toFixed(1)} / 5 (${(item.payload as RatingTrendPoint).count} rated)`,
              'Average',
            ]}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
          <Line type="monotone" dataKey="average" stroke={bar} strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function RatingListItem({ item, onClick }: { item: ConversationRatingListItem; onClick: (conversationId: string) => void }) {
  const subtitleParts = [item.projectName, item.agentName, item.model].filter(Boolean)
  const tags = [...item.toolNames, ...item.skillNames]
  return (
    <div
      onClick={() => onClick(item.conversationId)}
      className="group flex flex-col gap-1 rounded-lg px-2 py-2 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate flex-1">{item.conversationTitle}</p>
        <StarRow rating={item.rating} />
      </div>
      {subtitleParts.length > 0 && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{subtitleParts.join(' · ')}</p>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 6).map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {tag}
            </span>
          ))}
        </div>
      )}
      {item.note && <p className="text-[10px] text-gray-500 dark:text-gray-400 italic truncate">"{item.note}"</p>}
    </div>
  )
}

type SortMode = 'recent' | 'rating'

export function RatingsPane() {
  const selectConversation = useAppStore((s) => s.selectConversation)

  const [ratings, setRatings] = useState<ConversationRatingListItem[]>([])
  const [stats, setStats] = useState<ConversationRatingStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sortMode, setSortMode] = useState<SortMode>('recent')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [list, ratingStats] = await Promise.all([
        window.api.listConversationRatings(),
        window.api.getConversationRatingStats(),
      ])
      setRatings(list)
      setStats(ratingStats)
    } catch {
      // leave existing data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])
  useEffect(() => window.api.onConversationRated(() => void loadAll()), [loadAll])

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase()
    const list = q
      ? ratings.filter((r) =>
          r.conversationTitle.toLowerCase().includes(q) ||
          (r.agentName ?? '').toLowerCase().includes(q) ||
          (r.model ?? '').toLowerCase().includes(q) ||
          (r.projectName ?? '').toLowerCase().includes(q) ||
          r.toolNames.some((t) => t.toLowerCase().includes(q)) ||
          r.skillNames.some((s) => s.toLowerCase().includes(q)),
        )
      : ratings
    return [...list].sort((a, b) => (sortMode === 'rating' ? b.rating - a.rating : b.updatedAt - a.updatedAt))
  }, [ratings, deferredQuery, sortMode])

  const hasStats =
    stats.averageByAgent.length > 0 || stats.averageByModel.length > 0 || stats.averageBySkill.length > 0 ||
    stats.averageByServer.length > 0 || stats.averageByProject.length > 0 || stats.trend.length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {ratings.length} rated conversation{ratings.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-2 space-y-0.5">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
          </div>
        ) : (
          <>
            {hasStats && (
              <div className="px-3 py-2 space-y-3 border-b border-gray-100 dark:border-gray-800">
                <RatingTrendChart data={stats.trend} />
                <RatingBarChart title="Average by Agent" data={stats.averageByAgent} />
                <RatingBarChart title="Average by Model" data={stats.averageByModel} />
                <RatingBarChart title="Average by Skill" data={stats.averageBySkill} />
                <RatingBarChart title="Average by MCP Server" data={stats.averageByServer} />
                <RatingBarChart title="Average by Project" data={stats.averageByProject} />
              </div>
            )}

            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ratings…"
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-400 focus:bg-white dark:focus:bg-gray-900 rounded-lg outline-none transition-colors placeholder:text-gray-400"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="text-[11px] px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="Sort ratings"
              >
                <option value="recent">Recent</option>
                <option value="rating">Rating</option>
              </select>
            </div>

            <div className="p-2 space-y-0.5">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-8 italic">
                  {deferredQuery ? `No ratings match "${deferredQuery}"` : 'No conversations rated yet'}
                </p>
              ) : (
                filtered.map((item) => (
                  <RatingListItem key={item.id} item={item} onClick={selectConversation} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
