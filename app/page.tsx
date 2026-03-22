'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid
} from 'recharts'
import Papa from 'papaparse'
import {
  Upload, Plus, Users, ChevronDown,
  FileText, Star, Trash2, BarChart2, Settings, UserPlus
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

// Design tokens
const BRAND = '#7C2D2D'
const BRAND_LIGHT = '#F5EDED'

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10) }

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toString()
}

function fmtPct(n: number, decimals = 1): string { return n.toFixed(decimals) + '%' }

function parseFlexDate(s: string): Date | null {
  if (!s) return null
  const d = new Date(s.trim())
  if (!isNaN(d.getTime())) return d
  const parts = s.trim().split('/')
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
  return posts.filter(p => { const d = parseFlexDate(p.date); return d ? monthKey(d) === mk : false })
}

function followersForMonth(data: FollowerPoint[], mk: string): number {
  return data
    .filter(p => { const d = parseFlexDate(p.date); return d ? monthKey(d) === mk : false })
    .reduce((s, p) => s + p.newFollowers, 0)
}

function uniqueMonths(posts: Post[]): string[] {
  const keys = new Set<string>()
  posts.forEach(p => { const d = parseFlexDate(p.date); if (d) keys.add(monthKey(d)) })
  return Array.from(keys).sort().reverse()
}

function tier(avgPerPost: number): { label: string; color: string; bg: string } {
  if (avgPerPost >= BENCHMARKS.top10PerPost) return { label: 'Top 10%', color: BRAND, bg: BRAND_LIGHT }
  if (avgPerPost >= BENCHMARKS.top25PerPost) return { label: 'Top 25%', color: '#16A34A', bg: '#F0FDF4' }
  if (avgPerPost >= BENCHMARKS.medianPerPost) return { label: 'Top 50%', color: '#D97706', bg: '#FFFBEB' }
  return { label: 'Below 50%', color: '#9CA3AF', bg: '#F9FAFB' }
}

function paceStatus(current: number, goal: number, dayOfMonth: number, daysInMonth: number) {
  const pct = goal > 0 ? current / goal : 0
  const timePct = dayOfMonth / daysInMonth
  if (pct >= 1) return { label: 'Achieved', color: '#16A34A', bg: '#F0FDF4' }
  if (pct >= timePct * 0.9) return { label: 'On Pace', color: '#16A34A', bg: '#F0FDF4' }
  if (pct >= timePct * 0.6) return { label: 'Behind', color: '#D97706', bg: '#FFFBEB' }
  return { label: 'Off Track', color: '#DC2626', bg: '#FEF2F2' }
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

type Row = Record<string, string>

function findVal(row: Row, keys: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const k of keys) {
    const nk = norm(k)
    const found = Object.keys(row).find(rk => norm(rk) === nk || norm(rk).includes(nk))
    if (found && row[found] !== undefined) return (row[found] ?? '').trim()
  }
  return ''
}

function toNum(v: string): number {
  const n = parseFloat((v ?? '').replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

function parsePostsCSV(text: string): Post[] {
  const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() })
  return (data as Row[]).map(row => {
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
  }).filter(p => p.impressions > 0)
}

function parseFollowersCSV(text: string): FollowerPoint[] {
  const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() })
  return (data as Row[]).map(row => ({
    date: findVal(row, ['date']),
    newFollowers: toNum(findVal(row, ['new followers', 'newfollowers', 'organic followers', 'organicfollowers', 'followers']))
  })).filter(p => p.date)
}

// ─── Design Components ────────────────────────────────────────────────────────

function NotusLogo() {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: BRAND }}>
      <span className="text-white font-bold text-xl leading-none" style={{ fontFamily: 'Georgia, serif' }}>n</span>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] px-3 mb-1.5 mt-4 first:mt-0">
      {children}
    </p>
  )
}

function NavItem({ label, active, onClick, icon }: {
  label: string
  active: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left"
      style={active
        ? { backgroundColor: BRAND, color: 'white' }
        : { color: '#44403C' }
      }
    >
      <span className={active ? 'opacity-90' : 'opacity-50'}>{icon}</span>
      {label}
    </button>
  )
}

function StatCard({ label, value, sub, trend, accent = false }: {
  label: string
  value: string
  sub?: string
  trend?: { text: string; positive: boolean } | null
  accent?: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-[#EDE9E4] p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-3">{label}</p>
      <p className="text-3xl font-bold text-[#1C1917] mb-1.5 leading-none">{value}</p>
      {trend && (
        <p className={`text-xs font-medium mb-1 ${trend.positive ? 'text-green-600' : 'text-red-500'}`}>
          {trend.positive ? '↑' : '↓'} {trend.text}
        </p>
      )}
      {sub && (
        <p className="text-[11px] text-[#A8A29E] leading-snug">{sub}</p>
      )}
    </div>
  )
}

function GoalBar({ label, current, goal, pace }: {
  label: string
  current: number
  goal: number
  pace?: { day: number; daysInMonth: number }
}) {
  const pct = Math.min(100, goal > 0 ? (current / goal) * 100 : 0)
  const status = pace
    ? paceStatus(current, goal, pace.day, pace.daysInMonth)
    : {
        label: pct >= 100 ? 'Achieved' : pct >= 66 ? 'On Pace' : 'Behind',
        color: pct >= 100 ? '#16A34A' : pct >= 66 ? '#16A34A' : '#D97706',
        bg: pct >= 100 ? '#F0FDF4' : pct >= 66 ? '#F0FDF4' : '#FFFBEB'
      }
  const timePct = pace ? (pace.day / pace.daysInMonth) * 100 : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[#78716C]">{label}</span>
        <div className="flex items-center gap-2.5">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: status.bg, color: status.color }}
          >
            {status.label}
          </span>
          <span className="text-sm font-semibold text-[#1C1917] tabular-nums">
            {fmtN(current)} <span className="text-[#C7BFB8] font-normal">/ {fmtN(goal)}</span>
          </span>
        </div>
      </div>
      <div className="relative h-1.5 bg-[#F0EBE5] rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: status.color }}
        />
        {pace && timePct > 0 && timePct < 100 && (
          <div className="absolute inset-y-0 w-px bg-[#C7BFB8]" style={{ left: `${timePct}%` }} />
        )}
      </div>
    </div>
  )
}

function DropZone({ label, hint, onFile, accepted }: {
  label: string
  hint: string
  onFile: (file: File) => void
  accepted: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handle = useCallback((file: File) => {
    if (file.name.endsWith('.csv') || file.type === 'text/csv') onFile(file)
  }, [onFile])

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      className="relative border-2 border-dashed rounded-xl p-5 cursor-pointer transition-all text-center"
      style={accepted
        ? { borderColor: '#16A34A', backgroundColor: '#F0FDF4' }
        : dragging
        ? { borderColor: BRAND, backgroundColor: BRAND_LIGHT }
        : { borderColor: '#E7E0D8', backgroundColor: '#FAFAF9' }
      }
    >
      <input ref={ref} type="file" accept=".csv" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f) }} />
      {accepted ? (
        <>
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
            <span className="text-green-600 text-base font-bold">✓</span>
          </div>
          <p className="text-sm font-medium text-green-700">{label} uploaded</p>
        </>
      ) : (
        <>
          <Upload className="w-5 h-5 text-[#C7BFB8] mx-auto mb-2" />
          <p className="text-sm font-medium text-[#78716C]">{label}</p>
          <p className="text-xs text-[#A8A29E] mt-0.5">{hint}</p>
        </>
      )}
    </div>
  )
}

function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#1C1917]">{title}</h1>
        {subtitle && <p className="text-sm text-[#A8A29E] mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

// ─── Setup View ───────────────────────────────────────────────────────────────

interface MemberDraft {
  id: string
  name: string
  role: string
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

  function removeDraft(id: string) { setDrafts(d => d.filter(x => x.id !== id)) }

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
        updateDraft(draftId, { error: `Could not parse ${type} CSV: ${(err as Error).message}` })
      }
    }
    reader.readAsText(file)
  }

  const canLaunch = drafts.some(d => d.name.trim() && d.postsLoaded)

  function launch() {
    const members: Member[] = drafts
      .filter(d => d.name.trim() && d.postsLoaded)
      .map(d => ({ id: d.id, name: d.name.trim(), role: d.role.trim(), posts: d.posts, followerData: d.followerData, addedAt: Date.now() }))
    onComplete(members)
  }

  return (
    <div className="min-h-screen bg-[#F6F3EF] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#EDE9E4] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <NotusLogo />
          <div>
            <p className="text-sm font-semibold text-[#1C1917]">FBF LinkedIn Dashboard</p>
            <p className="text-xs text-[#A8A29E]">by notus</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-[#1C1917] mb-2">Set up your team</h1>
            <p className="text-sm text-[#78716C] max-w-md mx-auto leading-relaxed">
              Upload LinkedIn analytics exports for each team member to get started.
            </p>
          </div>

          {/* Instructions */}
          <div className="bg-white border border-[#EDE9E4] rounded-xl mb-5 overflow-hidden">
            <button
              onClick={() => setShowInstructions(s => !s)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm text-[#78716C] hover:text-[#1C1917] transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#C7BFB8]" />
                How to export from LinkedIn Analytics
              </span>
              <ChevronDown className={`w-4 h-4 text-[#C7BFB8] transition-transform ${showInstructions ? 'rotate-180' : ''}`} />
            </button>
            {showInstructions && (
              <div className="px-5 pb-5 border-t border-[#F0EBE5] pt-4 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>Post Analytics CSV</p>
                  <ol className="text-xs text-[#78716C] space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Go to your LinkedIn profile → click <strong className="text-[#44403C]">Analytics</strong></li>
                    <li>Click <strong className="text-[#44403C]">Content</strong> in the top nav</li>
                    <li>Set your date range (3–6 months recommended)</li>
                    <li>Click <strong className="text-[#44403C]">Export</strong> → download the CSV</li>
                  </ol>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>Followers CSV (optional)</p>
                  <ol className="text-xs text-[#78716C] space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Same Analytics page → click <strong className="text-[#44403C]">Followers</strong></li>
                    <li>Click <strong className="text-[#44403C]">Export</strong></li>
                  </ol>
                </div>
              </div>
            )}
          </div>

          {/* Member drafts */}
          <div className="space-y-4 mb-5">
            {drafts.map((draft, i) => (
              <div key={draft.id} className="bg-white border border-[#EDE9E4] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">Member {i + 1}</span>
                  {drafts.length > 1 && (
                    <button onClick={() => removeDraft(draft.id)} className="text-[#C7BFB8] hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-[#A8A29E] block mb-1.5">Full Name *</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => updateDraft(draft.id, { name: e.target.value })}
                      placeholder="Rick Cotton"
                      className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none focus:border-[#C7BFB8] transition-colors placeholder:text-[#C7BFB8]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#A8A29E] block mb-1.5">Role</label>
                    <input
                      type="text"
                      value={draft.role}
                      onChange={e => updateDraft(draft.id, { role: e.target.value })}
                      placeholder="Head of Sales"
                      className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none focus:border-[#C7BFB8] transition-colors placeholder:text-[#C7BFB8]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DropZone label="Post Analytics CSV" hint="Required" onFile={f => handleFile(draft.id, f, 'posts')} accepted={draft.postsLoaded} />
                  <DropZone label="Followers CSV" hint="Optional" onFile={f => handleFile(draft.id, f, 'followers')} accepted={draft.followersLoaded} />
                </div>
                {draft.postsLoaded && (
                  <p className="text-xs text-green-600 mt-2">{draft.posts.length} posts loaded{draft.followersLoaded && ` · ${draft.followerData.length} follower data points`}</p>
                )}
                {draft.error && <p className="text-xs text-red-500 mt-2">{draft.error}</p>}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={addDraft}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#EDE9E4] rounded-xl text-sm text-[#A8A29E] hover:border-[#C7BFB8] hover:text-[#78716C] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add another team member
            </button>
            <button
              onClick={launch}
              disabled={!canLaunch}
              className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white"
              style={{ backgroundColor: BRAND }}
            >
              {existing.length > 0 ? 'Update Dashboard' : 'Launch Dashboard'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function LeaderboardView({ members, selectedMonth }: { members: Member[]; selectedMonth: string }) {
  const rows = useMemo(() => {
    return members.map(m => {
      const mp = postsForMonth(m.posts, selectedMonth)
      const mf = followersForMonth(m.followerData, selectedMonth)
      const impressions = mp.reduce((s, p) => s + p.impressions, 0)
      const avgPerPost = mp.length > 0 ? impressions / mp.length : 0
      const avgEng = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
      const t = tier(avgPerPost)
      return { member: m, postCount: mp.length, impressions, avgPerPost, avgEng, followers: mf, tier: t }
    }).sort((a, b) => b.impressions - a.impressions)
  }, [members, selectedMonth])

  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0)
  const totalPosts = rows.reduce((s, r) => s + r.postCount, 0)
  const totalFollowers = rows.reduce((s, r) => s + r.followers, 0)
  const maxImpressions = Math.max(...rows.map(r => r.impressions), 1)

  return (
    <div className="space-y-5">
      {/* Team totals */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Team Impressions" value={fmtN(totalImpressions)} sub={`${members.length} members · ${monthLabel(selectedMonth)}`} />
        <StatCard label="Posts Published" value={totalPosts.toString()} sub={`${fmtN(totalImpressions / Math.max(totalPosts, 1))} avg impressions / post`} />
        <StatCard label="Follower Growth" value={`+${fmtN(totalFollowers)}`} sub={monthLabel(selectedMonth)} />
      </div>

      {/* Table */}
      <div className="bg-white border border-[#EDE9E4] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F0EBE5]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">Leaderboard — {monthLabel(selectedMonth)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#F6F3EF]">
                {['#', 'Name', 'Posts', 'Total Impressions', 'Avg / Post', 'Followers', 'Eng. Rate', 'Tier'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.member.id} className="border-b border-[#F6F3EF] hover:bg-[#FAFAF9] transition-colors">
                  <td className="px-5 py-4">
                    {i < 3
                      ? <span className="text-lg">{['🥇', '🥈', '🥉'][i]}</span>
                      : <span className="text-sm text-[#C7BFB8] font-mono">#{i + 1}</span>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                        style={{ backgroundColor: i === 0 ? BRAND : '#C7BFB8' }}>
                        {row.member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-[#1C1917]">{row.member.name}</p>
                        {row.member.role && <p className="text-xs text-[#A8A29E]">{row.member.role}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#78716C]">{row.postCount}</td>
                  <td className="px-5 py-4">
                    <div>
                      <span className="font-semibold text-[#1C1917]">{fmtN(row.impressions)}</span>
                      <div className="mt-1.5 h-1 w-20 bg-[#F0EBE5] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(row.impressions / maxImpressions) * 100}%`, backgroundColor: BRAND }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#78716C]">{row.postCount > 0 ? fmtN(row.avgPerPost) : '—'}</td>
                  <td className="px-5 py-4 text-green-700 font-medium">{row.followers > 0 ? `+${fmtN(row.followers)}` : '—'}</td>
                  <td className="px-5 py-4 text-[#78716C]">{row.postCount > 0 ? fmtPct(row.avgEng) : '—'}</td>
                  <td className="px-5 py-4">
                    {row.postCount > 0 && (
                      <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                        style={{ backgroundColor: row.tier.bg, color: row.tier.color }}>
                        {row.tier.label}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-[#FAFAF9] border-t border-[#F0EBE5] flex flex-wrap gap-x-5 gap-y-1">
          <span className="text-[10px] text-[#C7BFB8]">notus benchmark (50K posts)</span>
          <span className="text-[10px] text-[#C7BFB8]"><span style={{ color: BRAND }}>●</span> Top 10% = {fmtN(BENCHMARKS.top10PerPost)}/post</span>
          <span className="text-[10px] text-[#C7BFB8]"><span className="text-green-500">●</span> Top 25% = {fmtN(BENCHMARKS.top25PerPost)}/post</span>
          <span className="text-[10px] text-[#C7BFB8]"><span className="text-amber-500">●</span> Top 50% = {fmtN(BENCHMARKS.medianPerPost)}/post</span>
        </div>
      </div>
    </div>
  )
}

// ─── Member Profile ───────────────────────────────────────────────────────────

function MemberView({ member, goals, onGoalsChange }: {
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

  const chartData = useMemo(() => {
    return [...mp]
      .sort((a, b) => (parseFlexDate(a.date)?.getTime() ?? 0) - (parseFlexDate(b.date)?.getTime() ?? 0))
      .map((p, i) => ({ i: i + 1, impressions: p.impressions }))
  }, [mp])

  const followerChartData = useMemo(() => {
    return [...member.followerData]
      .filter(p => parseFlexDate(p.date))
      .sort((a, b) => (parseFlexDate(a.date)?.getTime() ?? 0) - (parseFlexDate(b.date)?.getTime() ?? 0))
      .slice(-12)
      .map(p => ({ date: p.date.slice(0, 7), newFollowers: p.newFollowers }))
  }, [member.followerData])

  const now = new Date()
  const isCurrentMonth = selectedMonth === monthKey(now)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const pace = isCurrentMonth ? { day: now.getDate(), daysInMonth } : undefined

  const insights: string[] = []
  if (avgPerPost >= BENCHMARKS.top10PerPost) insights.push(`Impressions per post (${fmtN(avgPerPost)}) is in the top 10% of all creators tracked by notus.`)
  else if (avgPerPost >= BENCHMARKS.top25PerPost) insights.push(`Impressions per post (${fmtN(avgPerPost)}) beats the top 25% benchmark of ${fmtN(BENCHMARKS.top25PerPost)}.`)
  else if (avgPerPost > 0) insights.push(`Impressions per post (${fmtN(avgPerPost)}) is below the top 25% threshold (${fmtN(BENCHMARKS.top25PerPost)}). Stronger hooks and more consistent posting can help.`)
  if (topPost && avgPerPost > 0 && topPost.impressions > avgPerPost * 1.5)
    insights.push(`Top post performed ${(topPost.impressions / avgPerPost).toFixed(1)}x above your monthly average — worth replicating the format.`)
  if (mf >= BENCHMARKS.top25MonthlyFollowers) insights.push(`Follower growth of +${fmtN(mf)} exceeds the top 25% benchmark of +${BENCHMARKS.top25MonthlyFollowers}/month.`)
  if (avgEngRate >= BENCHMARKS.top25EngRate) insights.push(`Engagement rate of ${fmtPct(avgEngRate)} is above benchmark (${BENCHMARKS.top25EngRate}%) — your audience is actively responding.`)

  return (
    <div className="space-y-5">
      {/* Member header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
            style={{ backgroundColor: BRAND }}>
            {member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h2 className="text-xl font-semibold text-[#1C1917]">{member.name}</h2>
              {avgPerPost > 0 && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: memberTier.bg, color: memberTier.color }}>
                  {memberTier.label} Creator
                </span>
              )}
            </div>
            {member.role && <p className="text-sm text-[#A8A29E]">{member.role}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#A8A29E]">Viewing</span>
          <div className="relative">
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg pl-3 pr-8 py-2 outline-none cursor-pointer appearance-none">
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-[#C7BFB8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {mp.length === 0 && (
        <div className="text-center py-16 bg-white border border-[#EDE9E4] rounded-xl">
          <BarChart2 className="w-10 h-10 text-[#E7E0D8] mx-auto mb-3" />
          <p className="text-[#A8A29E]">No posts found for {monthLabel(selectedMonth)}</p>
        </div>
      )}

      {mp.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Impressions" value={fmtN(totalImpressions)}
              trend={impDiff !== null ? { text: `${Math.abs(impDiff).toFixed(0)}% vs last month`, positive: impDiff >= 0 } : null}
              sub={avgPerPost >= BENCHMARKS.top25PerPost ? '✓ Above top 25% benchmark' : `Benchmark: ${fmtN(BENCHMARKS.top25PerPost)}/post`} />
            <StatCard label="New Followers" value={mf > 0 ? `+${fmtN(mf)}` : '—'}
              trend={follDiff !== null ? { text: `${Math.abs(follDiff).toFixed(0)}% vs last month`, positive: follDiff >= 0 } : null}
              sub={mf >= BENCHMARKS.top25MonthlyFollowers ? `✓ Above top 25% (+${BENCHMARKS.top25MonthlyFollowers})` : `Benchmark: +${BENCHMARKS.top25MonthlyFollowers}/mo`} />
            <StatCard label="Posts Published" value={mp.length.toString()} sub={`${fmtN(avgPerPost)} avg impressions / post`} />
            <StatCard label="Avg Engagement Rate" value={fmtPct(avgEngRate)}
              sub={avgEngRate >= BENCHMARKS.top25EngRate ? `✓ Above top 25% (${BENCHMARKS.top25EngRate}%)` : `Benchmark: ${BENCHMARKS.top25EngRate}%`} />
          </div>

          {insights.length > 0 && (
            <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: BRAND }}>Insights</p>
              <div className="space-y-2">
                {insights.map((ins, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="mt-0.5 flex-shrink-0" style={{ color: BRAND }}>→</span>
                    <p className="text-sm text-[#78716C] leading-relaxed">{ins}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`grid gap-4 ${followerChartData.length > 0 ? 'md:grid-cols-2' : ''}`}>
            <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-4">Impressions per Post — {monthLabel(selectedMonth)}</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#F0EBE5" vertical={false} />
                  <XAxis dataKey="i" tick={{ fill: '#C7BFB8', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#C7BFB8', fontSize: 10 }} tickFormatter={v => fmtN(v)} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'white', border: '1px solid #EDE9E4', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#A8A29E' }} itemStyle={{ color: '#1C1917' }}
                    formatter={(v: number) => [fmtN(v), 'Impressions']} />
                  <ReferenceLine y={BENCHMARKS.top25PerPost} stroke={BRAND} strokeDasharray="3 3" strokeOpacity={0.4}
                    label={{ value: 'Top 25%', fill: BRAND, fontSize: 9, position: 'insideTopRight' }} />
                  <Bar dataKey="impressions" fill={BRAND} fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {followerChartData.length > 0 && (
              <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-4">Follower Growth Trend</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={followerChartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#F0EBE5" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#C7BFB8', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#C7BFB8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'white', border: '1px solid #EDE9E4', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#A8A29E' }} itemStyle={{ color: '#1C1917' }}
                      formatter={(v: number) => [`+${v}`, 'New Followers']} />
                    <ReferenceLine y={BENCHMARKS.top25MonthlyFollowers} stroke="#16A34A" strokeDasharray="3 3" strokeOpacity={0.4}
                      label={{ value: 'Top 25%', fill: '#16A34A', fontSize: 9, position: 'insideTopRight' }} />
                    <Line type="monotone" dataKey="newFollowers" stroke="#16A34A" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#16A34A' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Goals */}
          <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
            <div className="flex items-center justify-between mb-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">Monthly Goals</p>
              {!editingGoals ? (
                <button onClick={() => { setDraftGoals(goals); setEditingGoals(true) }}
                  className="text-xs font-medium transition-colors hover:opacity-70" style={{ color: BRAND }}>
                  Edit goals
                </button>
              ) : (
                <div className="flex gap-4">
                  <button onClick={() => setEditingGoals(false)} className="text-xs text-[#A8A29E] hover:text-[#78716C]">Cancel</button>
                  <button onClick={() => { onGoalsChange(draftGoals); setEditingGoals(false) }}
                    className="text-xs font-medium" style={{ color: BRAND }}>Save</button>
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
                    <label className="text-xs text-[#A8A29E] block mb-1.5">{label}</label>
                    <input type="number" min={0} value={draftGoals[key]}
                      onChange={e => setDraftGoals(g => ({ ...g, [key]: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#C7BFB8] transition-colors" />
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
            <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-3.5 h-3.5" style={{ color: BRAND }} />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">Top Post — {monthLabel(selectedMonth)}</p>
              </div>
              <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                <div className="flex-1 min-w-0">
                  {topPost.url
                    ? <a href={topPost.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm hover:underline block truncate" style={{ color: BRAND }}>{topPost.url}</a>
                    : <p className="text-sm text-[#A8A29E]">Published {topPost.date}</p>}
                  <p className="text-xs text-[#C7BFB8] mt-1">{topPost.date}</p>
                  {avgPerPost > 0 && (
                    <p className="text-xs text-green-600 mt-2">
                      {(topPost.impressions / avgPerPost).toFixed(1)}x your monthly average ({fmtN(topPost.impressions)} vs {fmtN(avgPerPost)})
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-4 text-center flex-shrink-0">
                  {[
                    { label: 'Impressions', val: fmtN(topPost.impressions) },
                    { label: 'Likes', val: fmtN(topPost.likes) },
                    { label: 'Comments', val: fmtN(topPost.comments) },
                    { label: 'Shares', val: fmtN(topPost.shares) },
                    { label: 'Eng. Rate', val: fmtPct(topPost.engagementRate) },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-lg font-bold text-[#1C1917]">{val}</p>
                      <p className="text-[10px] text-[#A8A29E] mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Posts table */}
          <div className="bg-white border border-[#EDE9E4] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F0EBE5]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">All Posts — {monthLabel(selectedMonth)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F6F3EF]">
                    {['Date', 'Impressions', 'Likes', 'Comments', 'Shares', 'Follows', 'Eng. Rate', ''].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...mp].sort((a, b) => b.impressions - a.impressions).map((p, i) => (
                    <tr key={i} className="border-b border-[#F6F3EF] hover:bg-[#FAFAF9] transition-colors">
                      <td className="px-5 py-3 text-[#A8A29E]">{p.date}</td>
                      <td className="px-5 py-3">
                        <span className={`font-semibold ${p.impressions >= BENCHMARKS.top25PerPost ? 'text-[#1C1917]' : 'text-[#A8A29E]'}`}>
                          {fmtN(p.impressions)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.likes)}</td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.comments)}</td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.shares)}</td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.follows)}</td>
                      <td className="px-5 py-3">
                        <span className={p.engagementRate >= BENCHMARKS.top25EngRate ? 'text-green-600 font-medium' : 'text-[#A8A29E]'}>
                          {fmtPct(p.engagementRate)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs hover:underline" style={{ color: BRAND }}>View</a>}
                        {p.impressions >= BENCHMARKS.top25PerPost && (
                          <Star className="w-3 h-3 inline ml-1" style={{ color: BRAND }} />
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const { members: m, goals: g } = JSON.parse(saved)
        if (m && m.length > 0) { setMembers(m); setGoals(g ?? {}); setView('dashboard'); setActiveTab('leaderboard') }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (members.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify({ members, goals }))
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
    const g: Goals = {}
    newMembers.forEach(m => { g[m.id] = goals[m.id] ?? { ...DEFAULT_GOALS } })
    setGoals(g)
    setView('dashboard')
    setActiveTab('leaderboard')
  }

  if (view === 'setup') return <SetupView existing={members} onComplete={handleComplete} />

  const activeMember = members.find(m => m.id === activeTab) ?? null

  return (
    <div className="flex h-screen bg-[#F6F3EF] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-44 bg-white border-r border-[#EDE9E4] flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-[#F0EBE5]">
          <div className="flex items-center gap-2.5">
            <NotusLogo />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <SectionLabel>Navigation</SectionLabel>
          <NavItem
            label="Team"
            active={activeTab === 'leaderboard'}
            onClick={() => setActiveTab('leaderboard')}
            icon={<Users className="w-4 h-4" />}
          />
          {members.length > 0 && (
            <>
              <SectionLabel>Members</SectionLabel>
              {members.map(m => (
                <NavItem
                  key={m.id}
                  label={m.name.split(' ')[0]}
                  active={activeTab === m.id}
                  onClick={() => setActiveTab(m.id)}
                  icon={
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                      style={{ backgroundColor: activeTab === m.id ? 'rgba(255,255,255,0.3)' : '#EDE9E4', color: activeTab === m.id ? 'white' : BRAND }}>
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                  }
                />
              ))}
            </>
          )}
        </nav>

        {/* Settings */}
        <div className="px-3 py-3 border-t border-[#F0EBE5]">
          <SectionLabel>Settings</SectionLabel>
          <NavItem
            label="Manage"
            active={false}
            onClick={() => setView('setup')}
            icon={<UserPlus className="w-4 h-4" />}
          />
          <button
            onClick={() => { if (confirm('Reset all data?')) { localStorage.removeItem(STORAGE_KEY); setMembers([]); setGoals({}); setView('setup') } }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#C7BFB8] hover:text-red-400 transition-colors"
          >
            <Settings className="w-4 h-4 opacity-50" />
            Reset
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#F0EBE5]">
          <p className="text-[10px] text-[#C7BFB8]">by notus · notus.xyz</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          {/* Page header */}
          {activeTab === 'leaderboard' ? (
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-[#1C1917]">Team</h1>
                <p className="text-sm text-[#A8A29E] mt-0.5">LinkedIn performance overview</p>
              </div>
              {allMonthsAcross.length > 1 && (
                <div className="relative">
                  <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                    className="bg-white border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg pl-3 pr-8 py-2 outline-none cursor-pointer appearance-none">
                    {allMonthsAcross.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                  <ChevronDown className="w-3 h-3 text-[#C7BFB8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}
            </div>
          ) : activeMember ? (
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-[#1C1917]">{activeMember.name}</h1>
              <p className="text-sm text-[#A8A29E] mt-0.5">{activeMember.role || 'LinkedIn Performance'}</p>
            </div>
          ) : null}

          {activeTab === 'leaderboard'
            ? <LeaderboardView members={members} selectedMonth={selectedMonth} />
            : activeMember
            ? <MemberView
                member={activeMember}
                goals={goals[activeMember.id] ?? DEFAULT_GOALS}
                onGoalsChange={g => setGoals(prev => ({ ...prev, [activeMember.id]: g }))}
              />
            : null}
        </div>
      </main>
    </div>
  )
}
