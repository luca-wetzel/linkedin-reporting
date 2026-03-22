'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid
} from 'recharts'
import Papa from 'papaparse'
import {
  Upload, Plus, X, Users, TrendingUp, ChevronDown,
  FileText, Star, Target, Trash2, BarChart2
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Post {
  date: string
  url?: string
  impressions: number
  clicks: number
  likes: number
  comments: number
  shares: number
  follows: number
  engagements: number
  engagementRate: number
}

interface FollowerPoint {
  date: string
  newFollowers: number
}

interface Member {
  id: string
  name: string
  role: string
  posts: Post[]
  followerData: FollowerPoint[]
  addedAt: number
}

interface MemberGoals {
  monthlyPosts: number
  monthlyImpressions: number
  monthlyFollowers: number
}

interface Goals {
  [id: string]: MemberGoals
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BENCHMARKS = {
  top10PerPost: 2500,
  top25PerPost: 800,
  medianPerPost: 300,
  top25EngRate: 3.5,
  top25MonthlyFollowers: 150,
}

const DEFAULT_GOALS: MemberGoals = {
  monthlyPosts: 8,
  monthlyImpressions: 10000,
  monthlyFollowers: 100,
}

const STORAGE_KEY = 'fbf-dashboard-v1'

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toString()
}

function fmtPct(n: number, decimals = 1): string {
  return n.toFixed(decimals) + '%'
}

function parseFlexDate(s: string): Date | null {
  if (!s) return null
  const cleaned = s.trim()
  // ISO: 2026-03-15
  // "Mar 15, 2026" or "March 15, 2026"
  // "15/03/2026" or "03/15/2026"
  const d = new Date(cleaned)
  if (!isNaN(d.getTime())) return d
  // Try MM/DD/YYYY
  const parts = cleaned.split('/')
  if (parts.length === 3) {
    const d2 = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`)
    if (!isNaN(d2.getTime())) return d2
  }
  return null
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[parseInt(m) - 1]} ${y}`
}

function postsForMonth(posts: Post[], mk: string): Post[] {
  return posts.filter(p => {
    const d = parseFlexDate(p.date)
    return d ? monthKey(d) === mk : false
  })
}

function followersForMonth(data: FollowerPoint[], mk: string): number {
  return data
    .filter(p => { const d = parseFlexDate(p.date); return d ? monthKey(d) === mk : false })
    .reduce((s, p) => s + p.newFollowers, 0)
}

function uniqueMonths(posts: Post[]): string[] {
  const keys = new Set<string>()
  posts.forEach(p => {
    const d = parseFlexDate(p.date)
    if (d) keys.add(monthKey(d))
  })
  return Array.from(keys).sort().reverse()
}

function tier(avgPerPost: number): { label: string; color: string; desc: string } {
  if (avgPerPost >= BENCHMARKS.top10PerPost) return { label: 'Top 10%', color: '#E53E2D', desc: 'Exceptional performer' }
  if (avgPerPost >= BENCHMARKS.top25PerPost) return { label: 'Top 25%', color: '#22C55E', desc: 'Above benchmark' }
  if (avgPerPost >= BENCHMARKS.medianPerPost) return { label: 'Top 50%', color: '#F59E0B', desc: 'Near benchmark' }
  return { label: 'Below 50%', color: '#555', desc: 'Room to grow' }
}

function paceStatus(current: number, goal: number, dayOfMonth: number, daysInMonth: number) {
  const pct = goal > 0 ? current / goal : 0
  const timePct = dayOfMonth / daysInMonth
  const isOnPace = pct >= timePct * 0.9
  const isAchieved = pct >= 1
  if (isAchieved) return { label: 'Achieved', color: '#22C55E' }
  if (isOnPace) return { label: 'On Pace', color: '#22C55E' }
  if (pct >= timePct * 0.6) return { label: 'Behind', color: '#F59E0B' }
  return { label: 'Off Track', color: '#E53E2D' }
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

type Row = Record<string, string>

function findVal(row: Row, keys: string[]): string {
  const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const k of keys) {
    const nk = normKey(k)
    const found = Object.keys(row).find(rk => normKey(rk) === nk || normKey(rk).includes(nk))
    if (found && row[found] !== undefined) return (row[found] ?? '').trim()
  }
  return ''
}

function toNum(v: string): number {
  const n = parseFloat((v ?? '').replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

function parsePostsCSV(text: string): Post[] {
  const { data } = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim()
  })
  return (data as Row[])
    .map(row => {
      const impressions = toNum(findVal(row, ['impressions']))
      const clicks = toNum(findVal(row, ['clicks']))
      const likes = toNum(findVal(row, ['likes', 'reactions']))
      const comments = toNum(findVal(row, ['comments']))
      const shares = toNum(findVal(row, ['shares', 'reposts']))
      const follows = toNum(findVal(row, ['follows']))
      const rawEng = toNum(findVal(row, ['engagements']))
      const engagements = rawEng || likes + comments + shares + follows
      const engagementRate = impressions > 0 ? (engagements / impressions) * 100 : 0
      const date = findVal(row, ['date', 'published date', 'published_date'])
      const url = findVal(row, ['post', 'url', 'link', 'content'])
      return { date, url, impressions, clicks, likes, comments, shares, follows, engagements, engagementRate }
    })
    .filter(p => p.impressions > 0)
}

function parseFollowersCSV(text: string): FollowerPoint[] {
  const { data } = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim()
  })
  return (data as Row[])
    .map(row => ({
      date: findVal(row, ['date']),
      newFollowers: toNum(findVal(row, ['new followers', 'newfollowers', 'organic followers', 'organicfollowers', 'followers']))
    }))
    .filter(p => p.date)
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, trend, highlight = false
}: {
  label: string
  value: string
  sub?: string
  trend?: { text: string; positive: boolean } | null
  highlight?: boolean
}) {
  return (
    <div className={`rounded-xl p-5 border ${highlight ? 'border-[#E53E2D]/40 bg-[#E53E2D]/5' : 'border-[#222] bg-[#111]'}`}>
      <p className="text-[10px] text-[#555] uppercase tracking-widest font-semibold mb-3">{label}</p>
      <p className="text-3xl font-bold text-white mb-2 leading-none">{value}</p>
      {trend && (
        <p className={`text-xs font-medium mb-1 ${trend.positive ? 'text-green-400' : 'text-red-400'}`}>
          {trend.positive ? '↑' : '↓'} {trend.text}
        </p>
      )}
      {sub && <p className="text-[11px] text-[#444] leading-snug">{sub}</p>}
    </div>
  )
}

function GoalBar({
  label, current, goal, pace
}: {
  label: string
  current: number
  goal: number
  pace?: { day: number; daysInMonth: number }
}) {
  const pct = Math.min(100, goal > 0 ? (current / goal) * 100 : 0)
  const status = pace
    ? paceStatus(current, goal, pace.day, pace.daysInMonth)
    : { label: pct >= 100 ? 'Achieved' : pct >= 66 ? 'On Track' : 'Behind', color: pct >= 100 ? '#22C55E' : pct >= 66 ? '#22C55E' : '#F59E0B' }
  const timePct = pace ? (pace.day / pace.daysInMonth) * 100 : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[#888]">{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: status.color + '20', color: status.color }}>
            {status.label}
          </span>
          <span className="text-sm text-white font-medium tabular-nums">
            {fmtN(current)} <span className="text-[#444]">/ {fmtN(goal)}</span>
          </span>
        </div>
      </div>
      <div className="relative h-2 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: status.color }}
        />
        {pace && timePct > 0 && timePct < 100 && (
          <div
            className="absolute inset-y-0 w-px bg-[#555]"
            style={{ left: `${timePct}%` }}
            title="Today"
          />
        )}
      </div>
    </div>
  )
}

function DropZone({
  label, hint, onFile, accepted
}: {
  label: string
  hint: string
  onFile: (file: File) => void
  accepted: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handle = useCallback((file: File) => {
    if (file.name.endsWith('.csv') || file.type === 'text/csv') {
      onFile(file)
    }
  }, [onFile])

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      className={`relative border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all text-center ${
        accepted
          ? 'border-green-500/60 bg-green-500/5'
          : dragging
          ? 'border-[#E53E2D]/60 bg-[#E53E2D]/5'
          : 'border-[#2A2A2A] hover:border-[#444] bg-[#0D0D0D]'
      }`}
    >
      <input ref={ref} type="file" accept=".csv" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f) }} />
      {accepted ? (
        <>
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-2">
            <span className="text-green-400 text-lg">✓</span>
          </div>
          <p className="text-sm font-medium text-green-400">{label} uploaded</p>
        </>
      ) : (
        <>
          <Upload className="w-5 h-5 text-[#444] mx-auto mb-2" />
          <p className="text-sm font-medium text-[#888]">{label}</p>
          <p className="text-xs text-[#444] mt-1">{hint}</p>
        </>
      )}
    </div>
  )
}

// ─── Setup View ───────────────────────────────────────────────────────────────

interface MemberDraft {
  id: string
  name: string
  role: string
  postsFile?: File
  followersFile?: File
  postsLoaded: boolean
  followersLoaded: boolean
  posts: Post[]
  followerData: FollowerPoint[]
  error?: string
}

function SetupView({ existing, onComplete }: {
  existing: Member[]
  onComplete: (members: Member[]) => void
}) {
  const [drafts, setDrafts] = useState<MemberDraft[]>(
    existing.length > 0
      ? existing.map(m => ({ id: m.id, name: m.name, role: m.role, postsLoaded: m.posts.length > 0, followersLoaded: m.followerData.length > 0, posts: m.posts, followerData: m.followerData }))
      : [{ id: uid(), name: '', role: '', postsLoaded: false, followersLoaded: false, posts: [], followerData: [] }]
  )
  const [showInstructions, setShowInstructions] = useState(false)

  function addDraft() {
    setDrafts(d => [...d, { id: uid(), name: '', role: '', postsLoaded: false, followersLoaded: false, posts: [], followerData: [] }])
  }

  function removeDraft(id: string) {
    setDrafts(d => d.filter(x => x.id !== id))
  }

  function updateDraft(id: string, patch: Partial<MemberDraft>) {
    setDrafts(d => d.map(x => x.id === id ? { ...x, ...patch, error: undefined } : x))
  }

  function handleFile(draftId: string, file: File, type: 'posts' | 'followers') {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      try {
        if (type === 'posts') {
          const posts = parsePostsCSV(text)
          if (posts.length === 0) throw new Error('No valid post data found')
          updateDraft(draftId, { posts, postsLoaded: true })
        } else {
          const followerData = parseFollowersCSV(text)
          updateDraft(draftId, { followerData, followersLoaded: true })
        }
      } catch (err) {
        updateDraft(draftId, { error: `Failed to parse ${type} CSV: ${(err as Error).message}` })
      }
    }
    reader.readAsText(file)
  }

  const canLaunch = drafts.some(d => d.name.trim() && d.postsLoaded)

  function launch() {
    const members: Member[] = drafts
      .filter(d => d.name.trim() && d.postsLoaded)
      .map(d => ({
        id: d.id,
        name: d.name.trim(),
        role: d.role.trim(),
        posts: d.posts,
        followerData: d.followerData,
        addedAt: Date.now()
      }))
    onComplete(members)
  }

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1A1A1A] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#E53E2D] font-bold text-xl tracking-tight">notus</span>
          <span className="text-[#2A2A2A]">|</span>
          <span className="text-[#555] text-sm font-medium">FBF LinkedIn Dashboard</span>
        </div>
        <span className="text-xs text-[#333] font-mono">v1</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-white mb-3">Team LinkedIn Dashboard</h1>
            <p className="text-[#555] text-sm max-w-md mx-auto leading-relaxed">
              Upload LinkedIn analytics CSV exports for each team member. The dashboard shows performance, goals, and how everyone compares to the notus benchmark.
            </p>
          </div>

          {/* Instructions */}
          <div className="mb-6 bg-[#0D0D0D] border border-[#1E1E1E] rounded-xl overflow-hidden">
            <button
              onClick={() => setShowInstructions(s => !s)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm text-[#666] hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                How to export from LinkedIn Analytics
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showInstructions ? 'rotate-180' : ''}`} />
            </button>
            {showInstructions && (
              <div className="px-5 pb-5 space-y-3 border-t border-[#1A1A1A] pt-4">
                <div>
                  <p className="text-xs font-semibold text-[#E53E2D] uppercase tracking-widest mb-2">Post Analytics CSV</p>
                  <ol className="text-xs text-[#666] space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Go to your LinkedIn profile → click <strong className="text-[#888]">Analytics</strong></li>
                    <li>Click <strong className="text-[#888]">Content</strong> in the top nav</li>
                    <li>Set your date range (last 3–6 months recommended)</li>
                    <li>Click <strong className="text-[#888]">Export</strong> → download the CSV</li>
                  </ol>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#E53E2D] uppercase tracking-widest mb-2">Followers CSV (optional)</p>
                  <ol className="text-xs text-[#666] space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Same Analytics page → click <strong className="text-[#888]">Followers</strong></li>
                    <li>Click <strong className="text-[#888]">Export</strong></li>
                  </ol>
                </div>
                <p className="text-xs text-[#444] italic">The post CSV is required. Followers CSV is optional but unlocks follower growth tracking.</p>
              </div>
            )}
          </div>

          {/* Member drafts */}
          <div className="space-y-4 mb-6">
            {drafts.map((draft, i) => (
              <div key={draft.id} className="bg-[#111] border border-[#1E1E1E] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-[#444] uppercase tracking-widest">Team Member {i + 1}</span>
                  {drafts.length > 1 && (
                    <button onClick={() => removeDraft(draft.id)} className="text-[#444] hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-[#555] block mb-1.5">Full Name *</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => updateDraft(draft.id, { name: e.target.value })}
                      placeholder="e.g. Rick Cotton"
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-[#444] transition-colors placeholder:text-[#333]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#555] block mb-1.5">Role</label>
                    <input
                      type="text"
                      value={draft.role}
                      onChange={e => updateDraft(draft.id, { role: e.target.value })}
                      placeholder="e.g. Head of Sales"
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-[#444] transition-colors placeholder:text-[#333]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <DropZone
                    label="Post Analytics CSV"
                    hint="Required · LinkedIn Content export"
                    onFile={f => handleFile(draft.id, f, 'posts')}
                    accepted={draft.postsLoaded}
                  />
                  <DropZone
                    label="Followers CSV"
                    hint="Optional · LinkedIn Followers export"
                    onFile={f => handleFile(draft.id, f, 'followers')}
                    accepted={draft.followersLoaded}
                  />
                </div>

                {draft.postsLoaded && (
                  <p className="text-xs text-green-400 mt-2">
                    {draft.posts.length} posts loaded
                    {draft.followersLoaded && ` · ${draft.followerData.length} follower data points`}
                  </p>
                )}
                {draft.error && (
                  <p className="text-xs text-red-400 mt-2">{draft.error}</p>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={addDraft}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-[#2A2A2A] rounded-xl text-sm text-[#555] hover:border-[#444] hover:text-[#888] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add another team member
            </button>

            <button
              onClick={launch}
              disabled={!canLaunch}
              className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[#E53E2D] hover:bg-[#C23327] text-white"
            >
              {existing.length > 0 ? 'Update Dashboard' : 'Launch Dashboard'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── Leaderboard View ─────────────────────────────────────────────────────────

function LeaderboardView({ members, selectedMonth }: {
  members: Member[]
  selectedMonth: string
}) {
  const rows = useMemo(() => {
    return members
      .map(m => {
        const mp = postsForMonth(m.posts, selectedMonth)
        const mf = followersForMonth(m.followerData, selectedMonth)
        const impressions = mp.reduce((s, p) => s + p.impressions, 0)
        const avgPerPost = mp.length > 0 ? impressions / mp.length : 0
        const avgEng = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
        const t = tier(avgPerPost)
        const topPost = mp.reduce<Post | null>((top, p) => (!top || p.impressions > top.impressions) ? p : top, null)
        return { member: m, postCount: mp.length, impressions, avgPerPost, avgEng, followers: mf, tier: t, topPost }
      })
      .sort((a, b) => b.impressions - a.impressions)
  }, [members, selectedMonth])

  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0)
  const totalPosts = rows.reduce((s, r) => s + r.postCount, 0)
  const totalFollowers = rows.reduce((s, r) => s + r.followers, 0)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Team totals */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Team Impressions" value={fmtN(totalImpressions)} sub={`Across ${members.length} members · ${monthLabel(selectedMonth)}`} />
        <StatCard label="Team Posts Published" value={totalPosts.toString()} sub={`${(totalImpressions / Math.max(totalPosts, 1)).toFixed(0)} avg impressions / post`} />
        <StatCard label="Team Follower Growth" value={`+${fmtN(totalFollowers)}`} sub={`${monthLabel(selectedMonth)}`} />
      </div>

      {/* Leaderboard table */}
      <div className="bg-[#111] border border-[#222] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1A1A1A] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[#555] uppercase tracking-widest">Leaderboard — {monthLabel(selectedMonth)}</h3>
          <span className="text-xs text-[#333]">Ranked by total impressions</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1A1A1A]">
                {['#', 'Name', 'Posts', 'Total Impressions', 'Avg / Post', 'Follower Growth', 'Eng. Rate', 'Tier'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] font-semibold uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.member.id} className="border-b border-[#161616] hover:bg-[#161616] transition-colors">
                  <td className="px-5 py-4 text-xl">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-sm text-[#444] font-mono">#{i + 1}</span>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                        style={{ backgroundColor: ['#E53E2D', '#C23327', '#A02B22', '#7A2019'][i] || '#2A2A2A' }}>
                        {row.member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{row.member.name}</p>
                        {row.member.role && <p className="text-xs text-[#444] mt-0.5">{row.member.role}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#666]">{row.postCount}</td>
                  <td className="px-5 py-4">
                    <span className="font-bold text-white">{fmtN(row.impressions)}</span>
                    {row.postCount > 0 && (
                      <div className="mt-1 h-1 w-24 bg-[#1A1A1A] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#E53E2D]"
                          style={{ width: `${Math.min(100, (row.impressions / Math.max(...rows.map(r => r.impressions))) * 100)}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className={row.avgPerPost >= BENCHMARKS.top25PerPost ? 'text-white' : 'text-[#555]'}>
                      {row.postCount > 0 ? fmtN(row.avgPerPost) : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-green-400 font-medium">
                    {row.followers > 0 ? `+${fmtN(row.followers)}` : '—'}
                  </td>
                  <td className="px-5 py-4">
                    <span className={row.avgEng >= BENCHMARKS.top25EngRate ? 'text-green-400' : 'text-[#555]'}>
                      {row.postCount > 0 ? fmtPct(row.avgEng) : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {row.postCount > 0 && (
                      <span
                        className="text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ backgroundColor: row.tier.color + '20', color: row.tier.color }}
                      >
                        {row.tier.label}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Benchmark footer */}
        <div className="px-5 py-3 bg-[#0A0A0A] border-t border-[#1A1A1A]">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="text-[10px] text-[#333]">notus benchmark index (50K posts)</span>
            <span className="text-[10px] text-[#333]">
              <span className="text-[#E53E2D]">●</span> Top 10% = {fmtN(BENCHMARKS.top10PerPost)}/post
            </span>
            <span className="text-[10px] text-[#333]">
              <span className="text-green-600">●</span> Top 25% = {fmtN(BENCHMARKS.top25PerPost)}/post
            </span>
            <span className="text-[10px] text-[#333]">
              <span className="text-amber-600">●</span> Top 50% = {fmtN(BENCHMARKS.medianPerPost)}/post
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Member Profile View ──────────────────────────────────────────────────────

function MemberView({
  member, goals, onGoalsChange
}: {
  member: Member
  goals: MemberGoals
  onGoalsChange: (g: MemberGoals) => void
}) {
  const months = useMemo(() => {
    const all = uniqueMonths(member.posts)
    return all.length > 0 ? all : [monthKey(new Date())]
  }, [member.posts])

  const [selectedMonth, setSelectedMonth] = useState<string>(months[0])
  const [editingGoals, setEditingGoals] = useState(false)
  const [draftGoals, setDraftGoals] = useState<MemberGoals>(goals)

  const mp = useMemo(() => postsForMonth(member.posts, selectedMonth), [member.posts, selectedMonth])
  const mf = useMemo(() => followersForMonth(member.followerData, selectedMonth), [member.followerData, selectedMonth])

  const prevMonthIdx = months.indexOf(selectedMonth) + 1
  const prevMonth = months[prevMonthIdx] ?? null
  const prevMp = useMemo(() => prevMonth ? postsForMonth(member.posts, prevMonth) : [], [member.posts, prevMonth])
  const prevMf = useMemo(() => prevMonth ? followersForMonth(member.followerData, prevMonth) : 0, [member.followerData, prevMonth])

  const totalImpressions = mp.reduce((s, p) => s + p.impressions, 0)
  const prevImpressions = prevMp.reduce((s, p) => s + p.impressions, 0)
  const avgPerPost = mp.length > 0 ? totalImpressions / mp.length : 0
  const avgEngRate = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
  const memberTier = tier(avgPerPost)

  const topPost = mp.reduce<Post | null>((top, p) => (!top || p.impressions > top.impressions) ? p : top, null)

  const impDiff = prevImpressions > 0 ? ((totalImpressions - prevImpressions) / prevImpressions) * 100 : null
  const follDiff = prevMf > 0 ? ((mf - prevMf) / prevMf) * 100 : null

  // Chart data: posts sorted chronologically
  const chartData = useMemo(() => {
    return [...mp]
      .sort((a, b) => (parseFlexDate(a.date)?.getTime() ?? 0) - (parseFlexDate(b.date)?.getTime() ?? 0))
      .map((p, i) => ({
        i: i + 1,
        impressions: p.impressions,
        benchmark: BENCHMARKS.top25PerPost,
        engRate: parseFloat(p.engagementRate.toFixed(1)),
      }))
  }, [mp])

  // Follower trend (all time)
  const followerChartData = useMemo(() => {
    return [...member.followerData]
      .filter(p => parseFlexDate(p.date))
      .sort((a, b) => (parseFlexDate(a.date)?.getTime() ?? 0) - (parseFlexDate(b.date)?.getTime() ?? 0))
      .slice(-12)
      .map(p => ({ date: p.date.slice(0, 7), newFollowers: p.newFollowers }))
  }, [member.followerData])

  // Current month pace
  const now = new Date()
  const isCurrentMonth = selectedMonth === monthKey(now)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const pace = isCurrentMonth ? { day: now.getDate(), daysInMonth } : undefined

  // Auto-insights
  const insights: string[] = []
  if (avgPerPost >= BENCHMARKS.top10PerPost) insights.push(`Impressions per post (${fmtN(avgPerPost)}) is in the top 10% of all LinkedIn creators tracked by notus.`)
  else if (avgPerPost >= BENCHMARKS.top25PerPost) insights.push(`Impressions per post (${fmtN(avgPerPost)}) beats the top 25% benchmark of ${fmtN(BENCHMARKS.top25PerPost)}.`)
  else if (avgPerPost > 0) insights.push(`Impressions per post (${fmtN(avgPerPost)}) is below the top 25% threshold of ${fmtN(BENCHMARKS.top25PerPost)}. Increasing post frequency and hook strength can help.`)
  if (topPost && avgPerPost > 0 && topPost.impressions > avgPerPost * 1.5) insights.push(`Top post performed ${(topPost.impressions / avgPerPost).toFixed(1)}x above your monthly average — a signal worth replicating.`)
  if (mf >= BENCHMARKS.top25MonthlyFollowers) insights.push(`Follower growth of +${fmtN(mf)} this month beats the top 25% benchmark (+${BENCHMARKS.top25MonthlyFollowers}).`)
  if (avgEngRate >= BENCHMARKS.top25EngRate) insights.push(`Engagement rate of ${fmtPct(avgEngRate)} is above the top 25% threshold of ${BENCHMARKS.top25EngRate}% — your audience is actively responding.`)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Member header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#E53E2D] flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h2 className="text-xl font-bold text-white">{member.name}</h2>
              {avgPerPost > 0 && (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: memberTier.color + '20', color: memberTier.color }}
                >
                  {memberTier.label} Creator
                </span>
              )}
            </div>
            {member.role && <p className="text-sm text-[#555] mt-0.5">{member.role}</p>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[#444]">Viewing</span>
          <div className="relative">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-[#1A1A1A] border border-[#2A2A2A] text-white text-sm rounded-lg pl-3 pr-8 py-2 outline-none cursor-pointer"
            >
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-[#444] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Empty state */}
      {mp.length === 0 && (
        <div className="text-center py-16 bg-[#111] border border-[#1A1A1A] rounded-xl">
          <BarChart2 className="w-10 h-10 text-[#2A2A2A] mx-auto mb-3" />
          <p className="text-[#555]">No posts found for {monthLabel(selectedMonth)}</p>
          <p className="text-xs text-[#333] mt-1">Try selecting a different month</p>
        </div>
      )}

      {mp.length > 0 && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Impressions"
              value={fmtN(totalImpressions)}
              trend={impDiff !== null ? { text: `${Math.abs(impDiff).toFixed(0)}% vs last month`, positive: impDiff >= 0 } : null}
              sub={avgPerPost >= BENCHMARKS.top25PerPost ? `✓ Above top 25% benchmark` : `Benchmark: ${fmtN(BENCHMARKS.top25PerPost)}/post`}
              highlight={avgPerPost >= BENCHMARKS.top25PerPost}
            />
            <StatCard
              label="New Followers"
              value={mf > 0 ? `+${fmtN(mf)}` : '—'}
              trend={follDiff !== null ? { text: `${Math.abs(follDiff).toFixed(0)}% vs last month`, positive: follDiff >= 0 } : null}
              sub={mf >= BENCHMARKS.top25MonthlyFollowers ? `✓ Above top 25% (+${BENCHMARKS.top25MonthlyFollowers})` : `Benchmark: +${BENCHMARKS.top25MonthlyFollowers}/mo`}
            />
            <StatCard
              label="Posts Published"
              value={mp.length.toString()}
              sub={`${fmtN(avgPerPost)} avg impressions / post`}
            />
            <StatCard
              label="Avg Engagement Rate"
              value={fmtPct(avgEngRate)}
              sub={avgEngRate >= BENCHMARKS.top25EngRate ? `✓ Above top 25% (${BENCHMARKS.top25EngRate}%)` : `Benchmark: ${BENCHMARKS.top25EngRate}%`}
              highlight={avgEngRate >= BENCHMARKS.top25EngRate}
            />
          </div>

          {/* Insights */}
          {insights.length > 0 && (
            <div className="bg-[#0D0D0D] border border-[#1E1E1E] rounded-xl p-5 space-y-2">
              <p className="text-[10px] font-semibold text-[#E53E2D] uppercase tracking-widest mb-3">Auto Insights</p>
              {insights.map((ins, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-[#E53E2D] mt-0.5 flex-shrink-0">→</span>
                  <p className="text-sm text-[#888] leading-relaxed">{ins}</p>
                </div>
              ))}
            </div>
          )}

          {/* Charts */}
          <div className={`grid gap-4 ${followerChartData.length > 0 ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
            {/* Impressions chart */}
            <div className="bg-[#111] border border-[#222] rounded-xl p-6">
              <p className="text-[10px] font-semibold text-[#555] uppercase tracking-widest mb-4">
                Impressions per Post — {monthLabel(selectedMonth)}
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1A1A1A" vertical={false} />
                  <XAxis dataKey="i" tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#444', fontSize: 10 }} tickFormatter={v => fmtN(v)} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#666' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(v: number) => [fmtN(v), 'Impressions']}
                  />
                  <ReferenceLine
                    y={BENCHMARKS.top25PerPost}
                    stroke="#E53E2D"
                    strokeDasharray="3 3"
                    strokeOpacity={0.6}
                    label={{ value: 'Top 25%', fill: '#E53E2D', fontSize: 9, position: 'insideTopRight' }}
                  />
                  <Bar dataKey="impressions" fill="#E53E2D" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Follower growth trend */}
            {followerChartData.length > 0 && (
              <div className="bg-[#111] border border-[#222] rounded-xl p-6">
                <p className="text-[10px] font-semibold text-[#555] uppercase tracking-widest mb-4">Follower Growth Trend</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={followerChartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#1A1A1A" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#444', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#666' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(v: number) => [`+${v}`, 'New Followers']}
                    />
                    <ReferenceLine
                      y={BENCHMARKS.top25MonthlyFollowers}
                      stroke="#22C55E"
                      strokeDasharray="3 3"
                      strokeOpacity={0.5}
                      label={{ value: 'Top 25%', fill: '#22C55E', fontSize: 9, position: 'insideTopRight' }}
                    />
                    <Line type="monotone" dataKey="newFollowers" stroke="#22C55E" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#22C55E' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Goals */}
          <div className="bg-[#111] border border-[#222] rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">Monthly Goals</p>
              {!editingGoals ? (
                <button onClick={() => { setDraftGoals(goals); setEditingGoals(true) }} className="text-xs text-[#E53E2D] hover:text-red-400 transition-colors">
                  Set goals
                </button>
              ) : (
                <div className="flex gap-4">
                  <button onClick={() => setEditingGoals(false)} className="text-xs text-[#444] hover:text-[#888]">Cancel</button>
                  <button onClick={() => { onGoalsChange(draftGoals); setEditingGoals(false) }} className="text-xs text-[#E53E2D]">Save</button>
                </div>
              )}
            </div>

            {editingGoals ? (
              <div className="grid grid-cols-3 gap-4">
                {([
                  { key: 'monthlyPosts' as const, label: 'Posts / month' },
                  { key: 'monthlyImpressions' as const, label: 'Impressions / month' },
                  { key: 'monthlyFollowers' as const, label: 'New followers / month' },
                ]).map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-[#555] block mb-1.5">{label}</label>
                    <input
                      type="number"
                      min={0}
                      value={draftGoals[key]}
                      onChange={e => setDraftGoals(g => ({ ...g, [key]: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-[#444] transition-colors"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                <GoalBar label="Posts" current={mp.length} goal={goals.monthlyPosts} pace={pace} />
                <GoalBar label="Impressions" current={totalImpressions} goal={goals.monthlyImpressions} pace={pace} />
                <GoalBar label="Follower Growth" current={mf} goal={goals.monthlyFollowers} pace={pace} />
              </div>
            )}
          </div>

          {/* Top post */}
          {topPost && (
            <div className="bg-[#111] border border-[#222] rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-3.5 h-3.5 text-[#E53E2D]" />
                <p className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">Top Post — {monthLabel(selectedMonth)}</p>
              </div>
              <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                <div className="flex-1 min-w-0">
                  {topPost.url ? (
                    <a href={topPost.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-[#E53E2D] hover:underline block truncate">
                      {topPost.url}
                    </a>
                  ) : (
                    <p className="text-sm text-[#555]">Published {topPost.date}</p>
                  )}
                  <p className="text-xs text-[#444] mt-1">{topPost.date}</p>
                  {avgPerPost > 0 && (
                    <p className="text-xs text-green-400 mt-2">
                      {(topPost.impressions / avgPerPost).toFixed(1)}x your monthly average ({fmtN(topPost.impressions)} vs {fmtN(avgPerPost)})
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-4 md:gap-6 text-center flex-shrink-0">
                  {[
                    { label: 'Impressions', val: fmtN(topPost.impressions) },
                    { label: 'Likes', val: fmtN(topPost.likes) },
                    { label: 'Comments', val: fmtN(topPost.comments) },
                    { label: 'Shares', val: fmtN(topPost.shares) },
                    { label: 'Eng. Rate', val: fmtPct(topPost.engagementRate) },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-lg font-bold text-white">{val}</p>
                      <p className="text-[10px] text-[#444] mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Posts table */}
          <div className="bg-[#111] border border-[#222] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1A1A1A]">
              <p className="text-[10px] font-semibold text-[#555] uppercase tracking-widest">All Posts — {monthLabel(selectedMonth)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#161616]">
                    {['Date', 'Impressions', 'Likes', 'Comments', 'Shares', 'New Follows', 'Eng. Rate', ''].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] font-semibold uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...mp].sort((a, b) => b.impressions - a.impressions).map((p, i) => (
                    <tr key={i} className="border-b border-[#161616] hover:bg-[#161616] transition-colors">
                      <td className="px-5 py-3 text-[#666]">{p.date}</td>
                      <td className="px-5 py-3">
                        <span className={`font-semibold ${p.impressions >= BENCHMARKS.top25PerPost ? 'text-white' : 'text-[#666]'}`}>
                          {fmtN(p.impressions)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[#555]">{fmtN(p.likes)}</td>
                      <td className="px-5 py-3 text-[#555]">{fmtN(p.comments)}</td>
                      <td className="px-5 py-3 text-[#555]">{fmtN(p.shares)}</td>
                      <td className="px-5 py-3 text-[#555]">{fmtN(p.follows)}</td>
                      <td className="px-5 py-3">
                        <span className={p.engagementRate >= BENCHMARKS.top25EngRate ? 'text-green-400' : 'text-[#555]'}>
                          {fmtPct(p.engagementRate)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {p.url && (
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[#E53E2D] text-xs hover:underline">
                            View
                          </a>
                        )}
                        {p.impressions >= BENCHMARKS.top25PerPost && (
                          <Star className="w-3 h-3 text-[#E53E2D] inline ml-1" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Page() {
  const [members, setMembers] = useState<Member[]>([])
  const [goals, setGoals] = useState<Goals>({})
  const [view, setView] = useState<'setup' | 'dashboard'>('setup')
  const [activeTab, setActiveTab] = useState<string>('leaderboard')

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const { members: m, goals: g } = JSON.parse(saved)
        if (m && m.length > 0) {
          setMembers(m)
          setGoals(g ?? {})
          setView('dashboard')
          setActiveTab('leaderboard')
        }
      }
    } catch { /* ignore */ }
  }, [])

  // Save to localStorage
  useEffect(() => {
    if (members.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ members, goals }))
    }
  }, [members, goals])

  const allMonthsAcross = useMemo(() => {
    const keys = new Set<string>()
    members.forEach(m => uniqueMonths(m.posts).forEach(k => keys.add(k)))
    return Array.from(keys).sort().reverse()
  }, [members])

  const [selectedMonth, setSelectedMonth] = useState<string>(() => monthKey(new Date()))

  useEffect(() => {
    if (allMonthsAcross.length > 0) setSelectedMonth(allMonthsAcross[0])
  }, [allMonthsAcross])

  function handleComplete(newMembers: Member[]) {
    setMembers(newMembers)
    const defaultGoals: Goals = {}
    newMembers.forEach(m => {
      defaultGoals[m.id] = goals[m.id] ?? { ...DEFAULT_GOALS }
    })
    setGoals(defaultGoals)
    setView('dashboard')
    setActiveTab('leaderboard')
  }

  function handleGoalsChange(memberId: string, g: MemberGoals) {
    setGoals(prev => ({ ...prev, [memberId]: g }))
  }

  if (view === 'setup') {
    return <SetupView existing={members} onComplete={handleComplete} />
  }

  const activeMember = members.find(m => m.id === activeTab) ?? null

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1A1A1A] sticky top-0 z-10 bg-[#080808]/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-0 flex items-center">
          {/* Logo */}
          <div className="flex items-center gap-3 py-4 mr-8">
            <span className="text-[#E53E2D] font-bold text-lg tracking-tight">notus</span>
            <span className="text-[#222]">|</span>
            <span className="text-[#444] text-xs font-medium hidden sm:block">FBF LinkedIn Dashboard</span>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1 flex-1 overflow-x-auto py-3">
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'leaderboard'
                  ? 'bg-[#1A1A1A] text-white'
                  : 'text-[#555] hover:text-[#888]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Team
            </button>
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => setActiveTab(m.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === m.id
                    ? 'bg-[#1A1A1A] text-white'
                    : 'text-[#555] hover:text-[#888]'
                }`}
              >
                {m.name.split(' ')[0]}
              </button>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2 pl-4">
            {activeTab === 'leaderboard' && allMonthsAcross.length > 1 && (
              <div className="relative">
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="bg-[#1A1A1A] border border-[#2A2A2A] text-white text-xs rounded-lg pl-3 pr-7 py-1.5 outline-none cursor-pointer"
                >
                  {allMonthsAcross.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <ChevronDown className="w-3 h-3 text-[#444] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
            <button
              onClick={() => setView('setup')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#555] hover:text-white hover:bg-[#1A1A1A] transition-colors"
              title="Manage members"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Manage</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        {activeTab === 'leaderboard' ? (
          <LeaderboardView members={members} selectedMonth={selectedMonth} />
        ) : activeMember ? (
          <MemberView
            member={activeMember}
            goals={goals[activeMember.id] ?? DEFAULT_GOALS}
            onGoalsChange={g => handleGoalsChange(activeMember.id, g)}
          />
        ) : null}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#111] px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] text-[#2A2A2A]">Powered by notus · notus.xyz</span>
        <button
          onClick={() => {
            if (confirm('Reset all data? This cannot be undone.')) {
              localStorage.removeItem(STORAGE_KEY)
              setMembers([])
              setGoals({})
              setView('setup')
            }
          }}
          className="text-[10px] text-[#2A2A2A] hover:text-red-900 transition-colors"
        >
          Reset data
        </button>
      </footer>
    </div>
  )
}
