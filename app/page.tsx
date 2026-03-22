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
  FileText, Star, Trash2, BarChart2,
  UserPlus, RefreshCw, X, Check, Zap
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

interface ICPSignal {
  date: string
  name?: string
  company?: string
  title?: string
  action: string
  source?: string
  isIcp?: boolean
}

interface Member {
  id: string
  name: string
  role: string
  posts: Post[]
  icpSignals: ICPSignal[]
  addedAt: number
}

interface MemberGoals {
  monthlyPosts: number
  monthlyImpressions: number
  monthlyFollowers: number
  monthlyIcpSignals: number
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
  monthlyIcpSignals: 20,
}

const STORAGE_KEY = 'fbf-dashboard-v2'
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

// Follower growth = sum of "follows" column per month (followers gained from posts)
function followerGrowthForMonth(posts: Post[], mk: string): number {
  return postsForMonth(posts, mk).reduce((s, p) => s + p.follows, 0)
}

function icpForMonth(signals: ICPSignal[], mk: string): ICPSignal[] {
  return signals.filter(s => { const d = parseFlexDate(s.date); return d ? monthKey(d) === mk : false })
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

// ─── Smart Merge ──────────────────────────────────────────────────────────────
// Always upload the full 90-day CSV. Merge intelligently:
// - Match by URL (most reliable) → update metrics with fresher data
// - Match by date (if only one post that day or impressions within 20%) → update
// - No match → add as new

function smartMergePosts(existing: Post[], incoming: Post[]): Post[] {
  const result = existing.map(p => ({ ...p })) // clone

  for (const newPost of incoming) {
    // 1. Match by URL
    if (newPost.url) {
      const idx = result.findIndex(p => p.url && p.url === newPost.url)
      if (idx >= 0) {
        result[idx] = newPost // refresh with latest metrics
        continue
      }
    }

    // 2. Match by date — if same day and impressions within 20%, treat as same post
    const sameDayIdxs = result
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.date === newPost.date)

    if (sameDayIdxs.length === 1) {
      const { p, i } = sameDayIdxs[0]
      const diff = Math.abs(p.impressions - newPost.impressions)
      const threshold = Math.max(p.impressions, newPost.impressions) * 0.25
      if (diff <= threshold || p.impressions === 0) {
        result[i] = newPost
        continue
      }
    } else if (sameDayIdxs.length > 1) {
      // Multiple posts same day — find closest by impressions
      const best = sameDayIdxs.reduce((a, b) =>
        Math.abs(a.p.impressions - newPost.impressions) <= Math.abs(b.p.impressions - newPost.impressions) ? a : b
      )
      const diff = Math.abs(best.p.impressions - newPost.impressions)
      const threshold = Math.max(best.p.impressions, newPost.impressions) * 0.25
      if (diff <= threshold) {
        result[best.i] = newPost
        continue
      }
    }

    // 3. No match — new post, add it
    result.push(newPost)
  }

  return result
}

function smartMergeICP(existing: ICPSignal[], incoming: ICPSignal[]): ICPSignal[] {
  // Dedup by date+name+action
  const key = (s: ICPSignal) => `${s.date}|${(s.name ?? '').toLowerCase()}|${s.action.toLowerCase()}`
  const existingKeys = new Set(existing.map(key))
  const newSignals = incoming.filter(s => !existingKeys.has(key(s)))
  // Also update existing signals that match (in case ICP status changed)
  const updated = existing.map(s => {
    const match = incoming.find(n => key(n) === key(s))
    return match ?? s
  })
  return [...updated, ...newSignals]
}

// ─── CSV Parsers ──────────────────────────────────────────────────────────────

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

// Single LinkedIn CSV contains post analytics (and "follows" column = follower growth per post)
function parseLinkedInCSV(text: string): Post[] {
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

function parseICPSignalsCSV(text: string): ICPSignal[] {
  const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() })
  return (data as Row[]).map(row => {
    const isIcpRaw = findVal(row, ['icp', 'is_icp', 'icp_match', 'icp match', 'qualified', 'isicp']).toLowerCase()
    return {
      date: findVal(row, ['date']),
      name: findVal(row, ['name', 'person', 'full name', 'contact']) || undefined,
      company: findVal(row, ['company', 'organization', 'account']) || undefined,
      title: findVal(row, ['title', 'job title', 'position', 'role']) || undefined,
      action: findVal(row, ['action', 'signal', 'type', 'signal type', 'activity', 'event']) || 'signal',
      source: findVal(row, ['post', 'source', 'url', 'link', 'post url']) || undefined,
      isIcp: isIcpRaw ? (isIcpRaw === 'true' || isIcpRaw === '1' || isIcpRaw === 'yes') : undefined,
    }
  }).filter(s => s.date)
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

function NavItem({ label, active, onClick, icon, onDelete }: {
  label: string; active: boolean; onClick: () => void; icon: React.ReactNode; onDelete?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onClick}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left pr-7"
        style={active ? { backgroundColor: BRAND, color: 'white' } : { color: '#44403C' }}>
        <span className={active ? 'opacity-90' : 'opacity-50'}>{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {onDelete && hovered && (
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-[#C7BFB8] hover:text-red-400 hover:bg-red-50 transition-colors"
          title="Remove">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, trend }: {
  label: string; value: string; sub?: string; trend?: { text: string; positive: boolean } | null
}) {
  return (
    <div className="bg-white rounded-xl border border-[#EDE9E4] p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-3">{label}</p>
      <p className="text-3xl font-bold text-[#1C1917] mb-1.5 leading-none">{value}</p>
      {trend && <p className={`text-xs font-medium mb-1 ${trend.positive ? 'text-green-600' : 'text-red-500'}`}>{trend.positive ? '↑' : '↓'} {trend.text}</p>}
      {sub && <p className="text-[11px] text-[#A8A29E] leading-snug">{sub}</p>}
    </div>
  )
}

function GoalBar({ label, current, goal, pace }: {
  label: string; current: number; goal: number; pace?: { day: number; daysInMonth: number }
}) {
  const pct = Math.min(100, goal > 0 ? (current / goal) * 100 : 0)
  const status = pace
    ? paceStatus(current, goal, pace.day, pace.daysInMonth)
    : { label: pct >= 100 ? 'Achieved' : pct >= 66 ? 'On Pace' : 'Behind', color: pct >= 100 ? '#16A34A' : pct >= 66 ? '#16A34A' : '#D97706', bg: pct >= 100 ? '#F0FDF4' : pct >= 66 ? '#F0FDF4' : '#FFFBEB' }
  const timePct = pace ? (pace.day / pace.daysInMonth) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[#78716C]">{label}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: status.bg, color: status.color }}>{status.label}</span>
          <span className="text-sm font-semibold text-[#1C1917] tabular-nums">{fmtN(current)} <span className="text-[#C7BFB8] font-normal">/ {fmtN(goal)}</span></span>
        </div>
      </div>
      <div className="relative h-1.5 bg-[#F0EBE5] rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: status.color }} />
        {pace && timePct > 0 && timePct < 100 && <div className="absolute inset-y-0 w-px bg-[#C7BFB8]" style={{ left: `${timePct}%` }} />}
      </div>
    </div>
  )
}

function MiniDropZone({ label, onFile, success }: { label: string; onFile: (f: File) => void; success?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [done, setDone] = useState(false)
  useEffect(() => { if (success) { setDone(true); setTimeout(() => setDone(false), 3000) } }, [success])
  const handle = useCallback((f: File) => { if (f.name.endsWith('.csv') || f.type === 'text/csv') { onFile(f); setDone(true); setTimeout(() => setDone(false), 3000) } }, [onFile])
  return (
    <button onClick={() => ref.current?.click()}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all"
      style={done ? { borderColor: '#16A34A', backgroundColor: '#F0FDF4', color: '#16A34A' } : { borderColor: '#EDE9E4', backgroundColor: 'white', color: '#78716C' }}>
      <input ref={ref} type="file" accept=".csv" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = '' }} />
      {done ? <Check className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5 text-[#C7BFB8]" />}
      {done ? 'Updated!' : label}
    </button>
  )
}

// ─── Manage View ──────────────────────────────────────────────────────────────

function ManageView({ members, onUpdate, onDelete, onAdd, onDone }: {
  members: Member[]
  onUpdate: (id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'posts' | 'icpSignals'>>) => void
  onDelete: (id: string) => void
  onAdd: (member: Member) => void
  onDone: () => void
}) {
  const [showAddForm, setShowAddForm] = useState(members.length === 0)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newPosts, setNewPosts] = useState<Post[]>([])
  const [newPostsLoaded, setNewPostsLoaded] = useState(false)
  const [addError, setAddError] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')

  function handleUpdateFile(memberId: string, file: File, type: 'posts' | 'icp') {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      try {
        const member = members.find(m => m.id === memberId)
        if (!member) return
        if (type === 'posts') {
          const incoming = parseLinkedInCSV(text)
          if (incoming.length === 0) return
          const merged = smartMergePosts(member.posts, incoming)
          onUpdate(memberId, { posts: merged })
        } else {
          const incoming = parseICPSignalsCSV(text)
          const merged = smartMergeICP(member.icpSignals, incoming)
          onUpdate(memberId, { icpSignals: merged })
        }
      } catch { /* ignore */ }
    }
    reader.readAsText(file)
  }

  function handleNewFile(file: File, type: 'posts' | 'icp') {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      try {
        if (type === 'posts') {
          const posts = parseLinkedInCSV(text)
          if (posts.length === 0) { setAddError('No valid post data found'); return }
          setNewPosts(posts); setNewPostsLoaded(true); setAddError('')
        }
      } catch (err) { setAddError((err as Error).message) }
    }
    reader.readAsText(file)
  }

  function addMember() {
    if (!newName.trim() || !newPostsLoaded) return
    onAdd({ id: uid(), name: newName.trim(), role: newRole.trim(), posts: newPosts, icpSignals: [], addedAt: Date.now() })
    setNewName(''); setNewRole(''); setNewPosts([]); setNewPostsLoaded(false); setShowAddForm(false)
  }

  return (
    <div className="min-h-screen bg-[#F6F3EF]">
      <header className="bg-white border-b border-[#EDE9E4] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NotusLogo />
            <div>
              <p className="text-sm font-semibold text-[#1C1917]">Manage Dashboard</p>
              <p className="text-xs text-[#A8A29E]">Add, update, or remove team members</p>
            </div>
          </div>
          {members.length > 0 && (
            <button onClick={onDone} className="text-sm font-medium px-4 py-2 rounded-lg text-white" style={{ backgroundColor: BRAND }}>
              Back to Dashboard
            </button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        {/* Instructions */}
        <div className="bg-white border border-[#EDE9E4] rounded-xl overflow-hidden">
          <button onClick={() => setShowInstructions(s => !s)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm text-[#78716C] hover:text-[#1C1917] transition-colors">
            <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-[#C7BFB8]" />How to export from LinkedIn Analytics</span>
            <ChevronDown className={`w-4 h-4 text-[#C7BFB8] transition-transform ${showInstructions ? 'rotate-180' : ''}`} />
          </button>
          {showInstructions && (
            <div className="px-5 pb-5 border-t border-[#F0EBE5] pt-4 space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>LinkedIn Analytics CSV (90-day export)</p>
                <ol className="text-xs text-[#78716C] space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Go to your LinkedIn profile → click <strong className="text-[#44403C]">Analytics</strong></li>
                  <li>Click <strong className="text-[#44403C]">Content</strong> in the top nav</li>
                  <li>Set the date range to <strong className="text-[#44403C]">last 90 days</strong></li>
                  <li>Click <strong className="text-[#44403C]">Export</strong> → download the CSV</li>
                </ol>
                <p className="text-xs text-[#A8A29E] mt-2 italic">Always export 90 days. The dashboard merges intelligently — no duplicates.</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>ICP Signals CSV (optional — from notus)</p>
                <p className="text-xs text-[#78716C] leading-relaxed">Export the ICP signal tracking data from notus. Expected columns: Date, Name, Company, Title, Action, ICP Match (true/false).</p>
              </div>
            </div>
          )}
        </div>

        {/* Existing members */}
        {members.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-3">Team Members</p>
            <div className="space-y-3">
              {members.map(m => {
                const months = uniqueMonths(m.posts)
                const latest = months[0]
                const latestPosts = latest ? postsForMonth(m.posts, latest) : []
                const latestImpressions = latestPosts.reduce((s, p) => s + p.impressions, 0)
                const isEditing = editingId === m.id

                return (
                  <div key={m.id} className="bg-white border border-[#EDE9E4] rounded-xl p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: BRAND }}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        {isEditing ? (
                          <div className="flex gap-2 flex-1">
                            <input value={editName} onChange={e => setEditName(e.target.value)}
                              className="flex-1 bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-1.5 outline-none" placeholder="Name" />
                            <input value={editRole} onChange={e => setEditRole(e.target.value)}
                              className="flex-1 bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-1.5 outline-none" placeholder="Role" />
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <p className="font-semibold text-[#1C1917] truncate">{m.name}</p>
                            {m.role && <p className="text-xs text-[#A8A29E]">{m.role}</p>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isEditing ? (
                          <>
                            <button onClick={() => { onUpdate(m.id, { name: editName.trim(), role: editRole.trim() }); setEditingId(null) }}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg text-white" style={{ backgroundColor: BRAND }}>Save</button>
                            <button onClick={() => setEditingId(null)} className="text-xs text-[#A8A29E]">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(m.id); setEditName(m.name); setEditRole(m.role) }}
                              className="text-xs text-[#A8A29E] hover:text-[#78716C] px-2 py-1 rounded hover:bg-[#F6F3EF]">Edit</button>
                            <button onClick={() => { if (confirm(`Remove ${m.name}?`)) onDelete(m.id) }}
                              className="text-[#C7BFB8] hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-[#A8A29E]">
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />{m.posts.length} posts loaded</span>
                      {m.icpSignals.length > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />{m.icpSignals.length} ICP signals</span>}
                      {latest && <span className="text-[#C7BFB8]">Latest: {monthLabel(latest)} · {fmtN(latestImpressions)} impr.</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <MiniDropZone label="Update Analytics CSV (90d)" onFile={f => handleUpdateFile(m.id, f, 'posts')} />
                      <MiniDropZone label="Update ICP Signals" onFile={f => handleUpdateFile(m.id, f, 'icp')} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Add new */}
        {!showAddForm ? (
          <button onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 border-2 border-dashed border-[#EDE9E4] rounded-xl text-sm text-[#A8A29E] hover:border-[#C7BFB8] hover:text-[#78716C] transition-colors bg-white">
            <Plus className="w-4 h-4" />Add team member
          </button>
        ) : (
          <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">New Member</p>
              <button onClick={() => { setShowAddForm(false); setNewName(''); setNewRole(''); setNewPosts([]); setNewPostsLoaded(false) }}
                className="text-[#C7BFB8] hover:text-[#78716C]"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-[#A8A29E] block mb-1.5">Full Name *</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Daryl Smith"
                  className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#C7BFB8]" />
              </div>
              <div>
                <label className="text-xs text-[#A8A29E] block mb-1.5">Role</label>
                <input type="text" value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="e.g. Loan Officer"
                  className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#C7BFB8]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { type: 'posts' as const, label: 'LinkedIn Analytics CSV', hint: 'Required · 90-day export', loaded: newPostsLoaded },
                { type: 'icp' as const, label: 'ICP Signals CSV', hint: 'Optional · from notus', loaded: false },
              ].map(({ type, label, hint, loaded }) => {
                const r = useRef<HTMLInputElement>(null)
                return (
                  <div key={type} onClick={() => r.current?.click()}
                    className="border-2 border-dashed rounded-xl p-5 cursor-pointer transition-all text-center"
                    style={loaded ? { borderColor: '#16A34A', backgroundColor: '#F0FDF4' } : { borderColor: '#E7E0D8', backgroundColor: '#FAFAF9' }}>
                    <input ref={r} type="file" accept=".csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleNewFile(f, type); e.target.value = '' }} />
                    {loaded ? (
                      <><div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-1.5"><span className="text-green-600 font-bold">✓</span></div>
                        <p className="text-sm font-medium text-green-700">{label} loaded</p></>
                    ) : (
                      <><Upload className="w-5 h-5 text-[#C7BFB8] mx-auto mb-1.5" />
                        <p className="text-sm font-medium text-[#78716C]">{label}</p>
                        <p className="text-xs text-[#A8A29E] mt-0.5">{hint}</p></>
                    )}
                  </div>
                )
              })}
            </div>
            {addError && <p className="text-xs text-red-500 mb-3">{addError}</p>}
            <button onClick={addMember} disabled={!newName.trim() || !newPostsLoaded}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: BRAND }}>Add Member</button>
          </div>
        )}

        {members.length > 0 && (
          <button onClick={onDone} className="w-full py-3 rounded-xl text-sm font-medium border border-[#EDE9E4] text-[#78716C] hover:bg-white transition-colors">
            Done — Back to Dashboard
          </button>
        )}
      </main>
    </div>
  )
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function LeaderboardView({ members, selectedMonth }: { members: Member[]; selectedMonth: string }) {
  const rows = useMemo(() => {
    return members.map(m => {
      const mp = postsForMonth(m.posts, selectedMonth)
      const mf = followerGrowthForMonth(m.posts, selectedMonth)
      const icp = icpForMonth(m.icpSignals, selectedMonth)
      const impressions = mp.reduce((s, p) => s + p.impressions, 0)
      const avgPerPost = mp.length > 0 ? impressions / mp.length : 0
      const avgEng = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
      const t = tier(avgPerPost)
      const icpMatched = icp.filter(s => s.isIcp).length
      return { member: m, postCount: mp.length, impressions, avgPerPost, avgEng, followers: mf, tier: t, icpTotal: icp.length, icpMatched }
    }).sort((a, b) => b.impressions - a.impressions)
  }, [members, selectedMonth])

  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0)
  const totalPosts = rows.reduce((s, r) => s + r.postCount, 0)
  const totalFollowers = rows.reduce((s, r) => s + r.followers, 0)
  const totalIcp = rows.reduce((s, r) => s + r.icpTotal, 0)
  const maxImpressions = Math.max(...rows.map(r => r.impressions), 1)
  const hasIcp = rows.some(r => r.icpTotal > 0)

  return (
    <div className="space-y-5">
      <div className={`grid gap-4 ${hasIcp ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <StatCard label="Team Impressions" value={fmtN(totalImpressions)} sub={`${members.length} members · ${monthLabel(selectedMonth)}`} />
        <StatCard label="Posts Published" value={totalPosts.toString()} sub={`${fmtN(totalImpressions / Math.max(totalPosts, 1))} avg impressions / post`} />
        <StatCard label="Follower Growth" value={`+${fmtN(totalFollowers)}`} sub={monthLabel(selectedMonth)} />
        {hasIcp && <StatCard label="ICP Signals" value={fmtN(totalIcp)} sub="Total LinkedIn signals this month" />}
      </div>

      <div className="bg-white border border-[#EDE9E4] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F0EBE5]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">Leaderboard — {monthLabel(selectedMonth)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#F6F3EF]">
                {['#', 'Name', 'Posts', 'Total Impressions', 'Avg / Post', 'Followers', 'Eng. Rate', ...(hasIcp ? ['ICP Signals'] : []), 'Tier'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.member.id} className="border-b border-[#F6F3EF] hover:bg-[#FAFAF9] transition-colors">
                  <td className="px-5 py-4">
                    {i < 3 ? <span className="text-lg">{['🥇', '🥈', '🥉'][i]}</span> : <span className="text-sm text-[#C7BFB8] font-mono">#{i + 1}</span>}
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
                    <span className="font-semibold text-[#1C1917]">{fmtN(row.impressions)}</span>
                    <div className="mt-1.5 h-1 w-20 bg-[#F0EBE5] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(row.impressions / maxImpressions) * 100}%`, backgroundColor: BRAND }} />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#78716C]">{row.postCount > 0 ? fmtN(row.avgPerPost) : '—'}</td>
                  <td className="px-5 py-4 text-green-700 font-medium">{row.followers > 0 ? `+${fmtN(row.followers)}` : '—'}</td>
                  <td className="px-5 py-4 text-[#78716C]">{row.postCount > 0 ? fmtPct(row.avgEng) : '—'}</td>
                  {hasIcp && (
                    <td className="px-5 py-4">
                      {row.icpTotal > 0 ? (
                        <div>
                          <span className="font-medium text-[#1C1917]">{row.icpTotal}</span>
                          {row.icpMatched > 0 && <span className="text-xs text-amber-600 ml-1.5">({row.icpMatched} ICP)</span>}
                        </div>
                      ) : '—'}
                    </td>
                  )}
                  <td className="px-5 py-4">
                    {row.postCount > 0 && (
                      <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: row.tier.bg, color: row.tier.color }}>
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
  member: Member; goals: MemberGoals; onGoalsChange: (g: MemberGoals) => void
}) {
  const months = useMemo(() => { const all = uniqueMonths(member.posts); return all.length > 0 ? all : [monthKey(new Date())] }, [member.posts])
  const [selectedMonth, setSelectedMonth] = useState<string>(months[0])
  const [editingGoals, setEditingGoals] = useState(false)
  const [draftGoals, setDraftGoals] = useState<MemberGoals>(goals)

  const mp = useMemo(() => postsForMonth(member.posts, selectedMonth), [member.posts, selectedMonth])
  const mf = useMemo(() => followerGrowthForMonth(member.posts, selectedMonth), [member.posts, selectedMonth])
  const icpMonth = useMemo(() => icpForMonth(member.icpSignals, selectedMonth), [member.icpSignals, selectedMonth])

  const prevMonthIdx = months.indexOf(selectedMonth) + 1
  const prevMonth = months[prevMonthIdx] ?? null
  const prevMp = useMemo(() => prevMonth ? postsForMonth(member.posts, prevMonth) : [], [member.posts, prevMonth])
  const prevMf = useMemo(() => prevMonth ? followerGrowthForMonth(member.posts, prevMonth) : 0, [member.posts, prevMonth])
  const prevIcp = useMemo(() => prevMonth ? icpForMonth(member.icpSignals, prevMonth).length : 0, [member.icpSignals, prevMonth])

  const totalImpressions = mp.reduce((s, p) => s + p.impressions, 0)
  const prevImpressions = prevMp.reduce((s, p) => s + p.impressions, 0)
  const avgPerPost = mp.length > 0 ? totalImpressions / mp.length : 0
  const avgEngRate = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
  const memberTier = tier(avgPerPost)
  const topPost = mp.reduce<Post | null>((top, p) => (!top || p.impressions > top.impressions) ? p : top, null)
  const impDiff = prevImpressions > 0 ? ((totalImpressions - prevImpressions) / prevImpressions) * 100 : null
  const follDiff = prevMf > 0 ? ((mf - prevMf) / prevMf) * 100 : null
  const icpDiff = prevIcp > 0 ? ((icpMonth.length - prevIcp) / prevIcp) * 100 : null
  const icpMatched = icpMonth.filter(s => s.isIcp).length
  const hasIcp = member.icpSignals.length > 0

  // ICP action breakdown
  const icpByAction = useMemo(() => {
    const counts: Record<string, number> = {}
    icpMonth.forEach(s => { counts[s.action] = (counts[s.action] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [icpMonth])

  // Monthly follower trend from posts
  const followerChartData = useMemo(() => {
    const byMonth: Record<string, number> = {}
    member.posts.forEach(p => { const d = parseFlexDate(p.date); if (d) { const mk = monthKey(d); byMonth[mk] = (byMonth[mk] || 0) + p.follows } })
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-9).map(([date, newFollowers]) => ({ date, newFollowers }))
  }, [member.posts])

  const chartData = useMemo(() => {
    return [...mp].sort((a, b) => (parseFlexDate(a.date)?.getTime() ?? 0) - (parseFlexDate(b.date)?.getTime() ?? 0))
      .map((p, i) => ({ i: i + 1, impressions: p.impressions }))
  }, [mp])

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
  if (icpMatched > 0) insights.push(`${icpMatched} confirmed ICP signal${icpMatched > 1 ? 's' : ''} this month — these are real pipeline opportunities worth following up.`)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: BRAND }}>
            {member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h2 className="text-xl font-semibold text-[#1C1917]">{member.name}</h2>
              {avgPerPost > 0 && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: memberTier.bg, color: memberTier.color }}>
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
          {/* Stat cards */}
          <div className={`grid gap-4 ${hasIcp ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
            <StatCard label="Total Impressions" value={fmtN(totalImpressions)}
              trend={impDiff !== null ? { text: `${Math.abs(impDiff).toFixed(0)}% vs last month`, positive: impDiff >= 0 } : null}
              sub={avgPerPost >= BENCHMARKS.top25PerPost ? '✓ Above top 25% benchmark' : `Benchmark: ${fmtN(BENCHMARKS.top25PerPost)}/post`} />
            <StatCard label="New Followers" value={mf > 0 ? `+${fmtN(mf)}` : '—'}
              trend={follDiff !== null ? { text: `${Math.abs(follDiff).toFixed(0)}% vs last month`, positive: follDiff >= 0 } : null}
              sub={mf >= BENCHMARKS.top25MonthlyFollowers ? `✓ Above top 25%` : `Benchmark: +${BENCHMARKS.top25MonthlyFollowers}/mo`} />
            <StatCard label="Posts Published" value={mp.length.toString()} sub={`${fmtN(avgPerPost)} avg impressions / post`} />
            <StatCard label="Avg Engagement Rate" value={fmtPct(avgEngRate)}
              sub={avgEngRate >= BENCHMARKS.top25EngRate ? `✓ Above top 25% (${BENCHMARKS.top25EngRate}%)` : `Benchmark: ${BENCHMARKS.top25EngRate}%`} />
            {hasIcp && (
              <StatCard label="ICP Signals"
                value={icpMonth.length.toString()}
                trend={icpDiff !== null ? { text: `${Math.abs(icpDiff).toFixed(0)}% vs last month`, positive: icpDiff >= 0 } : null}
                sub={icpMatched > 0 ? `${icpMatched} confirmed ICP match${icpMatched > 1 ? 'es' : ''}` : 'No ICP match data'} />
            )}
          </div>

          {/* Insights */}
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

          {/* Charts */}
          <div className={`grid gap-4 ${followerChartData.length > 1 ? 'md:grid-cols-2' : ''}`}>
            <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-4">Impressions per Post — {monthLabel(selectedMonth)}</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#F0EBE5" vertical={false} />
                  <XAxis dataKey="i" tick={{ fill: '#C7BFB8', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#C7BFB8', fontSize: 10 }} tickFormatter={v => fmtN(v)} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'white', border: '1px solid #EDE9E4', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#A8A29E' }} itemStyle={{ color: '#1C1917' }} formatter={(v: number) => [fmtN(v), 'Impressions']} />
                  <ReferenceLine y={BENCHMARKS.top25PerPost} stroke={BRAND} strokeDasharray="3 3" strokeOpacity={0.4}
                    label={{ value: 'Top 25%', fill: BRAND, fontSize: 9, position: 'insideTopRight' }} />
                  <Bar dataKey="impressions" fill={BRAND} fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {followerChartData.length > 1 && (
              <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-4">Follower Growth Trend</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={followerChartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#F0EBE5" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#C7BFB8', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#C7BFB8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'white', border: '1px solid #EDE9E4', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#A8A29E' }} itemStyle={{ color: '#1C1917' }} formatter={(v: number) => [`+${v}`, 'New Followers']} />
                    <ReferenceLine y={BENCHMARKS.top25MonthlyFollowers} stroke="#16A34A" strokeDasharray="3 3" strokeOpacity={0.4}
                      label={{ value: 'Top 25%', fill: '#16A34A', fontSize: 9, position: 'insideTopRight' }} />
                    <Line type="monotone" dataKey="newFollowers" stroke="#16A34A" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#16A34A' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* ICP Signals section */}
          {hasIcp && icpMonth.length > 0 && (
            <div className="bg-white border border-[#EDE9E4] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#F0EBE5] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">ICP Signals — {monthLabel(selectedMonth)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {icpByAction.slice(0, 3).map(([action, count]) => (
                    <span key={action} className="text-xs text-[#A8A29E]">
                      <span className="font-medium text-[#78716C]">{count}</span> {action}
                    </span>
                  ))}
                  {icpMatched > 0 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                      {icpMatched} ICP match{icpMatched > 1 ? 'es' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#F6F3EF]">
                      {['Date', 'Name', 'Company', 'Title', 'Signal', 'ICP'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {icpMonth.slice(0, 50).map((s, i) => (
                      <tr key={i} className="border-b border-[#F6F3EF] hover:bg-[#FAFAF9] transition-colors">
                        <td className="px-5 py-3 text-[#A8A29E] whitespace-nowrap">{s.date}</td>
                        <td className="px-5 py-3 font-medium text-[#1C1917]">{s.name || '—'}</td>
                        <td className="px-5 py-3 text-[#78716C]">{s.company || '—'}</td>
                        <td className="px-5 py-3 text-[#A8A29E]">{s.title || '—'}</td>
                        <td className="px-5 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#F6F3EF] text-[#78716C] font-medium capitalize">{s.action}</span>
                        </td>
                        <td className="px-5 py-3">
                          {s.isIcp === true && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">ICP ✓</span>}
                          {s.isIcp === false && <span className="text-[10px] text-[#C7BFB8]">No</span>}
                          {s.isIcp === undefined && <span className="text-[10px] text-[#C7BFB8]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {icpMonth.length > 50 && (
                <div className="px-5 py-3 border-t border-[#F0EBE5] text-xs text-[#A8A29E]">Showing 50 of {icpMonth.length} signals</div>
              )}
            </div>
          )}

          {/* Goals */}
          <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
            <div className="flex items-center justify-between mb-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E]">Monthly Goals</p>
              {!editingGoals ? (
                <button onClick={() => { setDraftGoals(goals); setEditingGoals(true) }} className="text-xs font-medium hover:opacity-70" style={{ color: BRAND }}>Edit goals</button>
              ) : (
                <div className="flex gap-4">
                  <button onClick={() => setEditingGoals(false)} className="text-xs text-[#A8A29E]">Cancel</button>
                  <button onClick={() => { onGoalsChange(draftGoals); setEditingGoals(false) }} className="text-xs font-medium" style={{ color: BRAND }}>Save</button>
                </div>
              )}
            </div>
            {editingGoals ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {([
                  { key: 'monthlyPosts' as const, label: 'Posts / month' },
                  { key: 'monthlyImpressions' as const, label: 'Impressions / month' },
                  { key: 'monthlyFollowers' as const, label: 'New followers / month' },
                  { key: 'monthlyIcpSignals' as const, label: 'ICP signals / month' },
                ]).map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-[#A8A29E] block mb-1.5">{label}</label>
                    <input type="number" min={0} value={draftGoals[key]}
                      onChange={e => setDraftGoals(g => ({ ...g, [key]: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2 outline-none" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                <GoalBar label="Posts" current={mp.length} goal={goals.monthlyPosts} pace={pace} />
                <GoalBar label="Impressions" current={totalImpressions} goal={goals.monthlyImpressions} pace={pace} />
                <GoalBar label="Follower Growth" current={mf} goal={goals.monthlyFollowers} pace={pace} />
                {hasIcp && <GoalBar label="ICP Signals" current={icpMonth.length} goal={goals.monthlyIcpSignals} pace={pace} />}
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
                  {topPost.url ? <a href={topPost.url} target="_blank" rel="noopener noreferrer"
                    className="text-sm hover:underline block truncate" style={{ color: BRAND }}>{topPost.url}</a>
                    : <p className="text-sm text-[#A8A29E]">Published {topPost.date}</p>}
                  <p className="text-xs text-[#C7BFB8] mt-1">{topPost.date}</p>
                  {avgPerPost > 0 && <p className="text-xs text-green-600 mt-2">{(topPost.impressions / avgPerPost).toFixed(1)}x your monthly average</p>}
                </div>
                <div className="grid grid-cols-5 gap-4 text-center flex-shrink-0">
                  {[
                    { label: 'Impressions', val: fmtN(topPost.impressions) },
                    { label: 'Likes', val: fmtN(topPost.likes) },
                    { label: 'Comments', val: fmtN(topPost.comments) },
                    { label: 'Shares', val: fmtN(topPost.shares) },
                    { label: 'Eng. Rate', val: fmtPct(topPost.engagementRate) },
                  ].map(({ label, val }) => (
                    <div key={label}><p className="text-lg font-bold text-[#1C1917]">{val}</p><p className="text-[10px] text-[#A8A29E] mt-0.5">{label}</p></div>
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
                      <td className="px-5 py-3"><span className={`font-semibold ${p.impressions >= BENCHMARKS.top25PerPost ? 'text-[#1C1917]' : 'text-[#A8A29E]'}`}>{fmtN(p.impressions)}</span></td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.likes)}</td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.comments)}</td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.shares)}</td>
                      <td className="px-5 py-3 text-[#A8A29E]">{fmtN(p.follows)}</td>
                      <td className="px-5 py-3"><span className={p.engagementRate >= BENCHMARKS.top25EngRate ? 'text-green-600 font-medium' : 'text-[#A8A29E]'}>{fmtPct(p.engagementRate)}</span></td>
                      <td className="px-5 py-3">
                        {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: BRAND }}>View</a>}
                        {p.impressions >= BENCHMARKS.top25PerPost && <Star className="w-3 h-3 inline ml-1" style={{ color: BRAND }} />}
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
  const [view, setView] = useState<'manage' | 'dashboard'>('manage')
  const [activeTab, setActiveTab] = useState<string>('leaderboard')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const { members: m, goals: g } = JSON.parse(saved)
        if (m && m.length > 0) {
          // Migrate old data: add icpSignals if missing
          const migrated = m.map((mem: Member) => ({ ...mem, icpSignals: mem.icpSignals ?? [] }))
          setMembers(migrated); setGoals(g ?? {}); setView('dashboard'); setActiveTab('leaderboard')
        }
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
  useEffect(() => { if (allMonthsAcross.length > 0) setSelectedMonth(allMonthsAcross[0]) }, [allMonthsAcross])

  function handleUpdate(id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'posts' | 'icpSignals'>>) {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  function handleDelete(id: string) {
    const updated = members.filter(m => m.id !== id)
    setMembers(updated)
    if (updated.length === 0) { localStorage.removeItem(STORAGE_KEY); setView('manage') }
    else if (activeTab === id) setActiveTab('leaderboard')
  }

  function handleAdd(member: Member) {
    setMembers(prev => [...prev, member])
    setGoals(prev => ({ ...prev, [member.id]: { ...DEFAULT_GOALS } }))
  }

  if (view === 'manage') {
    return <ManageView members={members} onUpdate={handleUpdate} onDelete={handleDelete} onAdd={handleAdd}
      onDone={() => { if (members.length > 0) setView('dashboard') }} />
  }

  const activeMember = members.find(m => m.id === activeTab) ?? null

  return (
    <div className="flex h-screen bg-[#F6F3EF] overflow-hidden">
      <aside className="w-44 bg-white border-r border-[#EDE9E4] flex flex-col flex-shrink-0">
        <div className="px-4 py-4 border-b border-[#F0EBE5]"><NotusLogo /></div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <SectionLabel>Navigation</SectionLabel>
          <NavItem label="Team" active={activeTab === 'leaderboard'} onClick={() => setActiveTab('leaderboard')} icon={<Users className="w-4 h-4" />} />
          {members.length > 0 && (
            <>
              <SectionLabel>Members</SectionLabel>
              {members.map(m => (
                <NavItem key={m.id} label={m.name.split(' ')[0]} active={activeTab === m.id}
                  onClick={() => setActiveTab(m.id)} onDelete={() => handleDelete(m.id)}
                  icon={
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                      style={{ backgroundColor: activeTab === m.id ? 'rgba(255,255,255,0.3)' : '#EDE9E4', color: activeTab === m.id ? 'white' : BRAND }}>
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                  }
                />
              ))}
            </>
          )}
        </nav>
        <div className="px-3 py-3 border-t border-[#F0EBE5]">
          <SectionLabel>Settings</SectionLabel>
          <NavItem label="Manage" active={false} onClick={() => setView('manage')} icon={<UserPlus className="w-4 h-4" />} />
        </div>
        <div className="px-4 py-3 border-t border-[#F0EBE5]"><p className="text-[10px] text-[#C7BFB8]">by notus</p></div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          {activeTab === 'leaderboard' ? (
            <div className="flex items-center justify-between mb-6">
              <div><h1 className="text-2xl font-semibold text-[#1C1917]">Team</h1><p className="text-sm text-[#A8A29E] mt-0.5">LinkedIn performance overview</p></div>
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
            ? <MemberView member={activeMember} goals={goals[activeMember.id] ?? DEFAULT_GOALS}
                onGoalsChange={g => setGoals(prev => ({ ...prev, [activeMember.id]: g }))} />
            : null}
        </div>
      </main>
    </div>
  )
}
