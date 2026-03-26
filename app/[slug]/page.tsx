'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid
} from 'recharts'
import Papa from 'papaparse'
import {
  Upload, Plus, Users, ChevronDown,
  FileText, Star, Trash2, BarChart2,
  UserPlus, RefreshCw, X, Check, Zap, Menu
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

interface FollowerEntry {
  date: string
  newFollowers: number
}

interface Member {
  id: string
  name: string
  role: string
  posts: Post[]
  icpSignals: ICPSignal[]
  followerHistory: FollowerEntry[]
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

const SHIELD_INDEX = {
  brackets: [
    { label: '0–500 followers', typical: 106, strong: 294, top: 764 },
    { label: '500–1K followers', typical: 209, strong: 545, top: 1328 },
    { label: '1–2.5K followers', typical: 359, strong: 826, top: 2132 },
    { label: '2.5–5K followers', typical: 564, strong: 1329, top: 3409 },
    { label: '5–10K followers', typical: 798, strong: 1996, top: 5112 },
    { label: '10–25K followers', typical: 1280, strong: 3371, top: 9397 },
    { label: '25–50K followers', typical: 2464, strong: 6439, top: 18784 },
    { label: '50–75K followers', typical: 4973, strong: 12686, top: 35918 },
    { label: '75–100K followers', typical: 5940, strong: 16876, top: 53780 },
    { label: '100–250K followers', typical: 9739, strong: 27444, top: 77848 },
  ],
  followerGrowth: { typical: 50, strong: 150, top: 400 } as Record<string, number>,
}

const BRAND = '#722F37'
const BRAND_LIGHT = '#F4ECED'

// ─── Utilities ────────────────────────────────────────────────────────────────

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

function followerGrowthForMonth(posts: Post[], followerHistory: FollowerEntry[], mk: string): number {
  if (followerHistory.length > 0) {
    return followerHistory
      .filter(f => { const d = parseFlexDate(f.date); return d ? monthKey(d) === mk : false })
      .reduce((s, f) => s + f.newFollowers, 0)
  }
  return postsForMonth(posts, mk).reduce((s, p) => s + p.follows, 0)
}

function icpForMonth(signals: ICPSignal[], mk: string): ICPSignal[] {
  return signals.filter(s => { const d = parseFlexDate(s.date); return d ? monthKey(d) === mk : false })
}

type TaggedSignal = ICPSignal & { via?: string }

function attributeOrgSignal(signal: ICPSignal, members: Member[]): string | undefined {
  const action = (signal.action ?? '').toLowerCase()
  for (const m of members) {
    const full = m.name.toLowerCase()
    if (full && action.includes(full)) return m.name
    const first = m.name.split(' ')[0]?.toLowerCase()
    const last = m.name.split(' ').slice(1).join(' ').toLowerCase()
    if (last && action.includes(last)) return m.name
    if (first && first.length > 3 && action.includes(first)) return m.name
  }
  return undefined
}

function allSignals(members: Member[], orgIcpSignals: ICPSignal[]): TaggedSignal[] {
  return [
    ...orgIcpSignals.map(s => ({ ...s, via: attributeOrgSignal(s, members) })),
    ...members.flatMap(m => m.icpSignals.map(s => ({ ...s, via: m.name }))),
  ]
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

function isValidDate(s: string): boolean {
  if (!s || !s.trim()) return false
  const d = parseFlexDate(s)
  if (!d) return false
  const y = d.getFullYear()
  return y > 2000 && y < 2100
}

function smartMergePosts(existing: Post[], incoming: Post[]): Post[] {
  const result = existing.map(p => ({ ...p }))
  for (const newPost of incoming) {
    // Step 1: URL match (XLSX) — exact dedup, always replace
    if (newPost.url) {
      const idx = result.findIndex(p => p.url && p.url === newPost.url)
      if (idx >= 0) { result[idx] = newPost; continue }
    }

    // Step 2: Date match (CSV, no URL) — always replace with newer data
    const sameDayNoUrl = result.map((p, i) => ({ p, i })).filter(({ p }) => p.date === newPost.date && !p.url)
    if (sameDayNoUrl.length === 1 && !newPost.url) {
      result[sameDayNoUrl[0].i] = newPost
      continue
    }
    if (sameDayNoUrl.length > 1 && !newPost.url) {
      // Multiple posts same date without URLs — replace closest by impressions
      const closest = sameDayNoUrl.reduce((a, b) =>
        Math.abs(a.p.impressions - newPost.impressions) <= Math.abs(b.p.impressions - newPost.impressions) ? a : b)
      result[closest.i] = newPost
      continue
    }

    // Step 3: No match — genuinely new post
    result.push(newPost)
  }
  return result
}

function smartMergeFollowers(existing: FollowerEntry[], incoming: FollowerEntry[]): FollowerEntry[] {
  const incomingMap = new Map(incoming.map(f => [f.date, f]))
  const merged = existing.map(f => incomingMap.get(f.date) ?? f)
  const existingDates = new Set(existing.map(f => f.date))
  incoming.forEach(f => { if (!existingDates.has(f.date)) merged.push(f) })
  return merged
}

function smartMergeICP(existing: ICPSignal[], incoming: ICPSignal[]): ICPSignal[] {
  const key = (s: ICPSignal) => `${s.date}|${(s.name ?? '').toLowerCase()}|${s.action.toLowerCase()}`
  const existingKeys = new Set(existing.map(key))
  const newSignals = incoming.filter(s => !existingKeys.has(key(s)))
  const updated = existing.map(s => { const match = incoming.find(n => key(n) === key(s)); return match ?? s })
  return [...updated, ...newSignals]
}

// ─── File Reader ──────────────────────────────────────────────────────────────

type ParsedLinkedInFile = { posts: Post[]; followerHistory: FollowerEntry[]; detectedColumns: string[] }

async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function parseLinkedInFile(file: File): Promise<ParsedLinkedInFile> {
  const isLikelyXlsx = /\.(xlsx|xls|xlsm)$/i.test(file.name) ||
    file.type.includes('spreadsheet') || file.type.includes('excel')
  if (isLikelyXlsx) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/parse-linkedin', { method: 'POST', body: form })
    if (res.ok) {
      const data = await res.json()
      data.posts = (data.posts ?? []).filter((p: Post) => isValidDate(p.date))
      return data
    }
  }
  const text = await readFileText(file)
  const { posts, detectedColumns } = parseLinkedInCSV(text)
  return { posts, followerHistory: [], detectedColumns }
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

const LINKEDIN_HEADER_KEYWORDS = ['impression', 'click', 'like', 'comment', 'share', 'follow', 'engagement', 'date', 'publish', 'view', 'content', 'post', 'url', 'reaction']

function parseLinkedInCSV(text: string): { posts: Post[]; detectedColumns: string[] } {
  const clean = text.replace(/^\uFEFF/, '')
  const lines = clean.split(/\r?\n/)
  let headerIdx = 0
  let bestScore = 0
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const lower = lines[i].toLowerCase()
    const score = LINKEDIN_HEADER_KEYWORDS.filter(k => lower.includes(k)).length
    if (score > bestScore) { bestScore = score; headerIdx = i }
  }
  const csvText = lines.slice(headerIdx).join('\n')
  const { data } = Papa.parse<Row>(csvText, {
    header: true, skipEmptyLines: true,
    transformHeader: h => h.trim().replace(/^\uFEFF/, ''),
  })
  const rows = data as Row[]
  const detectedColumns = rows.length > 0 ? Object.keys(rows[0]) : []
  const posts = rows.map(row => {
    const impressions = toNum(findVal(row, ['impressions', 'total impressions']))
    const clicks = toNum(findVal(row, ['clicks', 'total clicks']))
    const likes = toNum(findVal(row, ['likes', 'reactions', 'total reactions']))
    const comments = toNum(findVal(row, ['comments']))
    const shares = toNum(findVal(row, ['shares', 'reposts']))
    const follows = toNum(findVal(row, ['follows', 'followers gained']))
    const rawEng = toNum(findVal(row, ['engagements', 'total engagements']))
    const engagements = rawEng || likes + comments + shares + follows
    const engagementRate = impressions > 0 ? (engagements / impressions) * 100 : 0
    const date = findVal(row, ['content publish date', 'publish date', 'published date', 'date', 'published_date', 'post date'])
    const url = findVal(row, ['post url', 'post link', 'url', 'link']) || findVal(row, ['content'])
    return { date, url, impressions, clicks, likes, comments, shares, follows, engagements, engagementRate }
  }).filter(p => p.impressions > 0 && isValidDate(p.date))
  return { posts, detectedColumns }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim()
}

function isGojiberryFormat(rows: Row[]): boolean {
  if (rows.length === 0) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const keys = Object.keys(rows[0]).map(norm)
  return keys.some(k => k === 'firstname') && keys.some(k => k === 'lasttouchdate')
}

function parseGojiberryRow(row: Row): ICPSignal | null {
  const firstName = findVal(row, ['first name', 'firstname'])
  const lastName = findVal(row, ['last name', 'lastname'])
  const name = [firstName, lastName].filter(Boolean).join(' ') || undefined

  const rawDate = findVal(row, ['last touch date', 'lasttouchdate', 'last touch'])
  const date = rawDate ? rawDate.split(/[\sT]/)[0] : ''
  if (!date) return null

  const rawAction = findVal(row, ['last touch', 'lasttouch', 'activity', 'action'])
  const action = stripHtml(rawAction) || 'signal'

  return {
    date,
    name,
    company: findVal(row, ['company', 'organization', 'account']) || undefined,
    title: findVal(row, ['headline', 'title', 'job title', 'position', 'role']) || undefined,
    action,
    source: findVal(row, ['linkedin url', 'linkedinurl', 'linkedin', 'url', 'link']) || undefined,
    isIcp: true,
  }
}

function parseICPSignalsCSV(text: string): ICPSignal[] {
  const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() })
  const rows = data as Row[]

  if (isGojiberryFormat(rows)) {
    return rows.map(parseGojiberryRow).filter((s): s is ICPSignal => s !== null)
  }

  return rows.map(row => {
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
  }).filter(s => s.date && isValidDate(s.date))
}

async function parseICPFile(file: File): Promise<ICPSignal[]> {
  const isXlsx = /\.(xlsx|xls|xlsm)$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel')
  if (isXlsx) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/parse-icp', { method: 'POST', body: form })
    if (!res.ok) throw new Error('Couldn\'t read this file. Try re-downloading it or saving as CSV.')
    const json = await res.json()
    if (!json.signals || json.signals.length === 0) {
      throw new Error('No ICP signals found in this file. Make sure it has columns like name, date, and company.')
    }
    return json.signals
  }
  const text = await readFileText(file)
  return parseICPSignalsCSV(text)
}

// ─── Design Components ────────────────────────────────────────────────────────

function NotusLogo() {
  return <img src="/favicon.svg" alt="notus" className="w-9 h-9 flex-shrink-0" />
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] px-3 mb-1.5 mt-4 first:mt-0">
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
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-[#D4D4D4] hover:text-red-400 hover:bg-red-50 transition-colors"
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
  const textSize = value.length > 12 ? 'text-lg' : value.length > 8 ? 'text-xl' : 'text-3xl'
  return (
    <div className="bg-white rounded-xl border border-[#E8ECF0] p-4 md:p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-3">{label}</p>
      <p className={`${textSize} font-bold text-[#2D2D2D] mb-1.5 leading-tight truncate`}>{value}</p>
      {trend && <p className={`text-xs font-medium mb-1 ${trend.positive ? 'text-green-600' : 'text-red-500'}`}>{trend.positive ? '↑' : '↓'} {trend.text}</p>}
      {sub && <p className="text-[11px] text-[#6B6B6B] leading-snug">{sub}</p>}
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
        <span className="text-sm text-[#4A4A4A]">{label}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: status.bg, color: status.color }}>{status.label}</span>
          <span className="text-sm font-semibold text-[#2D2D2D] tabular-nums">{fmtN(current)} <span className="text-[#D4D4D4] font-normal">/ {fmtN(goal)}</span></span>
        </div>
      </div>
      <div className="relative h-1.5 bg-[#EEF1F5] rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: status.color }} />
        {pace && timePct > 0 && timePct < 100 && <div className="absolute inset-y-0 w-px bg-[#C7BFB8]" style={{ left: `${timePct}%` }} />}
      </div>
    </div>
  )
}

function MiniDropZone({ label, onFile }: {
  label: string
  onFile: (f: File, onResult: (success: boolean, msg?: string) => void) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [dragging, setDragging] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const handle = useCallback((f: File) => {
    const ok = /\.(csv|xlsx|xls|xlsm)$/i.test(f.name)
    if (!ok) { setErrMsg('This file type isn\'t supported. Please upload a .csv or .xlsx file.'); setStatus('err'); setTimeout(() => setStatus('idle'), 4000); return }
    onFile(f, (success, msg) => {
      if (success) { setStatus('ok'); setTimeout(() => setStatus('idle'), 3000) }
      else { setErrMsg(msg || 'No data found'); setStatus('err'); setTimeout(() => setStatus('idle'), 5000) }
    })
  }, [onFile])
  const style = status === 'ok'
    ? { borderColor: '#16A34A', backgroundColor: '#F0FDF4', color: '#16A34A' }
    : status === 'err'
    ? { borderColor: '#DC2626', backgroundColor: '#FEF2F2', color: '#DC2626' }
    : dragging
    ? { borderColor: '#722F37', backgroundColor: '#F4ECED', color: '#722F37' }
    : { borderColor: '#E8ECF0', backgroundColor: 'white', color: '#78716C' }
  return (
    <div className="flex flex-col gap-1">
      <input ref={ref} type="file" accept=".csv,.xlsx,.xls,.xlsm" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = '' }} />
      <div role="button" tabIndex={0}
        onClick={() => ref.current?.click()}
        onKeyDown={e => e.key === 'Enter' && ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handle(f) }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer" style={style}>
        {status === 'ok' ? <Check className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" style={{ color: status === 'err' ? '#DC2626' : dragging ? '#722F37' : '#C7BFB8' }} />}
        {status === 'ok' ? 'Updated!' : status === 'err' ? 'Failed' : dragging ? 'Drop to upload' : label}
      </div>
      {status === 'err' && <p className="text-[10px] text-red-500 leading-tight max-w-[180px]">{errMsg}</p>}
    </div>
  )
}

function UploadCard({ type, label, hint, loaded, onFile }: {
  type: 'posts' | 'icp'; label: string; hint: string; loaded: boolean
  onFile: (f: File, type: 'posts' | 'icp') => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f, type) }}
      className="border-2 border-dashed rounded-xl p-5 cursor-pointer transition-all text-center"
      style={loaded ? { borderColor: '#16A34A', backgroundColor: '#F0FDF4' } : dragging ? { borderColor: '#722F37', backgroundColor: '#F4ECED' } : { borderColor: '#E7E0D8', backgroundColor: '#FAF8F3' }}>
      <input ref={ref} type="file" accept=".csv,.xlsx,.xls,.xlsm" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f, type); e.target.value = '' }} />
      {loaded ? (
        <><div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-1.5"><span className="text-green-600 font-bold text-sm">✓</span></div>
          <p className="text-sm font-medium text-green-700">{label} loaded</p></>
      ) : dragging ? (
        <><Upload className="w-5 h-5 mx-auto mb-1.5" style={{ color: '#722F37' }} />
          <p className="text-sm font-medium" style={{ color: '#722F37' }}>Drop to upload</p></>
      ) : (
        <><Upload className="w-5 h-5 text-[#D4D4D4] mx-auto mb-1.5" />
          <p className="text-sm font-medium text-[#4A4A4A]">{label}</p>
          <p className="text-xs text-[#6B6B6B] mt-0.5">{hint}</p></>
      )}
    </div>
  )
}

// ─── Undo Toast ──────────────────────────────────────────────────────────────

function UndoToast({ label, startedAt, duration, onUndo }: {
  label: string; startedAt: number; duration: number; onUndo: () => void
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - startedAt), 50)
    return () => clearInterval(interval)
  }, [startedAt])

  const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000))
  const progress = Math.min(1, elapsed / duration)

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#2D2D2D] text-white text-sm pl-5 pr-3 py-3 rounded-xl shadow-lg flex items-center gap-4 min-w-[280px]">
      <span className="flex-1">{label}</span>
      <button onClick={onUndo}
        className="font-semibold px-3 py-1 rounded-lg hover:bg-white/10 transition-colors whitespace-nowrap"
        style={{ color: BRAND_LIGHT }}>
        Undo ({remaining}s)
      </button>
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl overflow-hidden">
        <div className="h-full" style={{ width: `${(1 - progress) * 100}%`, backgroundColor: BRAND }} />
      </div>
    </div>
  )
}

// ─── Manage View ──────────────────────────────────────────────────────────────

type NewMemberData = { name: string; role: string; posts: Post[]; icpSignals: ICPSignal[]; followerHistory: FollowerEntry[] }

function ManageView({ members, orgName, onUpdate, onUpdateWithUndo, onDelete, onAdd, onDone, orgIcpSignals, onOrgIcpUpload, onOrgIcpClear, goals, onMemberGoalChange, onBulkGoals }: {
  members: Member[]
  orgName: string
  onUpdate: (id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'posts' | 'icpSignals' | 'followerHistory'>>) => void
  onUpdateWithUndo: (id: string, patch: Partial<Pick<Member, 'posts' | 'icpSignals' | 'followerHistory'>>, memberName: string) => void
  onDelete: (id: string) => void
  onAdd: (data: NewMemberData) => Promise<void>
  onDone: () => void
  orgIcpSignals: ICPSignal[]
  onOrgIcpUpload: (signals: ICPSignal[]) => Promise<void>
  onOrgIcpClear: () => void
  goals: Goals
  onMemberGoalChange: (memberId: string, g: MemberGoals) => void
  onBulkGoals: (g: MemberGoals) => void
}) {
  const [showAddForm, setShowAddForm] = useState(members.length === 0)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newPosts, setNewPosts] = useState<Post[]>([])
  const [newPostsLoaded, setNewPostsLoaded] = useState(false)
  const [newIcpSignals, setNewIcpSignals] = useState<ICPSignal[]>([])
  const [newIcpLoaded, setNewIcpLoaded] = useState(false)
  const [newFollowerHistory, setNewFollowerHistory] = useState<FollowerEntry[]>([])
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')
  const [confirmClearIcp, setConfirmClearIcp] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [editGoalsId, setEditGoalsId] = useState<string | null>(null)
  const [draftGoals, setDraftGoals] = useState<MemberGoals>(DEFAULT_GOALS)
  const [showGoalPanel, setShowGoalPanel] = useState(false)
  const [shieldTier, setShieldTier] = useState<'typical' | 'strong' | 'top'>('strong')
  const [shieldBracket, setShieldBracket] = useState(5) // index into SHIELD_INDEX.brackets (10-25K)
  const [shieldPosts, setShieldPosts] = useState(2)
  const [pendingUpload, setPendingUpload] = useState<{
    memberId: string; memberName: string; type: 'posts' | 'icp'
    data: Partial<Pick<Member, 'posts' | 'icpSignals' | 'followerHistory'>>
    summary: { postCount: number; dateRange?: string; totalImpressions: number; followerMonths: number; signalCount: number; noFollowerData: boolean }
    warning?: string
    onResult: (success: boolean, msg?: string) => void
  } | null>(null)

  function computeSummary(posts: Post[], followers: FollowerEntry[], signals: ICPSignal[]) {
    const dates = posts.map(p => p.date).filter(Boolean).sort()
    const from = dates[0]; const to = dates[dates.length - 1]
    const fromLabel = from ? monthLabel(from.slice(0, 7)) : ''
    const toLabel = to ? monthLabel(to.slice(0, 7)) : ''
    const dateRange = fromLabel && toLabel ? (fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`) : ''
    return {
      postCount: posts.length,
      dateRange: dateRange || undefined,
      totalImpressions: posts.reduce((s, p) => s + p.impressions, 0),
      followerMonths: followers.length,
      signalCount: signals.length,
      noFollowerData: posts.length > 0 && followers.length === 0,
    }
  }

  function extractLinkedInSlug(url: string): string | null {
    const match = url.match(/linkedin\.com\/(?:posts|pulse|feed\/update)\/([a-zA-Z0-9_-]+?)(?:_|-\d)/)
    return match?.[1]?.toLowerCase() ?? null
  }

  function detectMismatch(existing: Post[], incoming: Post[], memberName: string): string | undefined {
    // Primary: compare LinkedIn usernames from post URLs
    const existingSlugs = Array.from(new Set(existing.map(p => p.url ? extractLinkedInSlug(p.url) : null).filter(Boolean)))
    const incomingSlugs = Array.from(new Set(incoming.map(p => p.url ? extractLinkedInSlug(p.url) : null).filter(Boolean)))

    if (existingSlugs.length > 0 && incomingSlugs.length > 0) {
      const existingSet = new Set(existingSlugs)
      const overlap = incomingSlugs.some(s => existingSet.has(s))
      if (!overlap) {
        return `This file appears to be for "${incomingSlugs[0]}" but ${memberName}'s existing data is from "${existingSlugs[0]}". Are you sure this is the right file?`
      }
    }

    // Fallback: check if incoming slugs match member name at all
    if (incomingSlugs.length > 0 && existing.length === 0) {
      const slug = incomingSlugs[0] ?? ''
      const nameParts = memberName.toLowerCase().split(/\s+/)
      const nameInSlug = nameParts.some(part => part.length > 2 && slug.includes(part))
      if (!nameInSlug) {
        return `This file appears to be for "${slug}" — does that match ${memberName}?`
      }
    }

    return undefined
  }

  function handleUpdateFile(memberId: string, file: File, type: 'posts' | 'icp', onResult: (success: boolean, msg?: string) => void) {
    if (type === 'posts') {
      parseLinkedInFile(file).then(({ posts: incoming, followerHistory: incomingFollowers }) => {
        const member = members.find(m => m.id === memberId)
        if (!member) { onResult(false, 'Member not found'); return }
        if (incoming.length === 0 && incomingFollowers.length === 0) {
          onResult(false, 'No data found in this file. Go to LinkedIn → Analytics → download the 90-day export as XLSX.'); return
        }
        const merged = smartMergePosts(member.posts, incoming)
        const mergedFollowers = smartMergeFollowers(member.followerHistory, incomingFollowers)
        const summary = computeSummary(incoming, incomingFollowers, [])
        const warning = detectMismatch(member.posts, incoming, member.name)
        setPendingUpload({ memberId, memberName: member.name, type, data: { posts: merged, followerHistory: mergedFollowers }, summary, warning, onResult })
      }).catch(err => onResult(false, (err as Error).message))
    } else {
      parseICPFile(file).then(incoming => {
        const member = members.find(m => m.id === memberId)
        if (!member) { onResult(false, 'Member not found'); return }
        if (incoming.length === 0) { onResult(false, 'No signals found in this file. It may be empty or in an unexpected format.'); return }
        const merged = smartMergeICP(member.icpSignals, incoming)
        const summary = computeSummary([], [], incoming)
        setPendingUpload({ memberId, memberName: member.name, type, data: { icpSignals: merged }, summary, onResult })
      }).catch(err => onResult(false, (err as Error).message))
    }
  }

  function handleNewFile(file: File, type: 'posts' | 'icp') {
    if (type === 'posts') {
      parseLinkedInFile(file).then(({ posts, followerHistory }) => {
        if (posts.length === 0 && followerHistory.length === 0) {
          setAddError('No data found in this file. Go to LinkedIn → Analytics → download the 90-day export as XLSX.'); return
        }
        setNewPosts(posts); setNewPostsLoaded(true); setAddError(''); setNewFollowerHistory(followerHistory)
      }).catch(err => setAddError((err as Error).message))
    } else {
      parseICPFile(file).then(signals => {
        if (signals.length === 0) { setAddError('No signals found in this file. It may be empty or in an unexpected format.'); return }
        setNewIcpSignals(signals); setNewIcpLoaded(true)
      }).catch(err => setAddError((err as Error).message))
    }
  }

  async function addMember() {
    if (!newName.trim() || !newPostsLoaded || adding) return
    setAdding(true)
    try {
      await onAdd({ name: newName.trim(), role: newRole.trim(), posts: newPosts, icpSignals: newIcpSignals, followerHistory: newFollowerHistory })
      setNewName(''); setNewRole(''); setNewPosts([]); setNewPostsLoaded(false)
      setNewIcpSignals([]); setNewIcpLoaded(false); setNewFollowerHistory([]); setShowAddForm(false)
    } catch (e) {
      setAddError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FEFDFB]">
      <header className="bg-white border-b border-[#E8ECF0] px-4 py-3 md:px-6 md:py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <NotusLogo />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#2D2D2D] truncate">{orgName} — Manage</p>
              <p className="text-xs text-[#6B6B6B] hidden md:block">Add, update, or remove team members</p>
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
        <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden">
          <button onClick={() => setShowInstructions(s => !s)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm text-[#4A4A4A] hover:text-[#2D2D2D] transition-colors">
            <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-[#D4D4D4]" />How to export from LinkedIn Analytics</span>
            <ChevronDown className={`w-4 h-4 text-[#D4D4D4] transition-transform ${showInstructions ? 'rotate-180' : ''}`} />
          </button>
          {showInstructions && (
            <div className="px-5 pb-5 border-t border-[#EEF1F5] pt-4 space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>LinkedIn Analytics CSV (90-day export)</p>
                <ol className="text-xs text-[#4A4A4A] space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Go to your LinkedIn profile → click <strong className="text-[#2D2D2D]">Analytics</strong></li>
                  <li>Click <strong className="text-[#2D2D2D]">Content</strong> in the top nav</li>
                  <li>Set the date range to <strong className="text-[#2D2D2D]">last 90 days</strong></li>
                  <li>Click <strong className="text-[#2D2D2D]">Export</strong> → download the CSV</li>
                </ol>
                <p className="text-xs text-[#6B6B6B] mt-2 italic">Export as CSV or XLSX — both work. Always export 90 days. The dashboard merges intelligently — no duplicates.</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>ICP Signals (optional)</p>
                <p className="text-xs text-[#4A4A4A] leading-relaxed">Reach out to notus to add the ICP data. We&apos;ll upload this for you.</p>
              </div>
            </div>
          )}
        </div>

        {members.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-3">Team Members</p>
            <div className="space-y-3">
              {members.map(m => {
                const months = uniqueMonths(m.posts)
                const latest = months[0]
                const latestPosts = latest ? postsForMonth(m.posts, latest) : []
                const latestImpressions = latestPosts.reduce((s, p) => s + p.impressions, 0)
                const isEditing = editingId === m.id
                return (
                  <div key={m.id} className="bg-white border border-[#E8ECF0] rounded-xl p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: BRAND }}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        {isEditing ? (
                          <div className="flex gap-2 flex-1">
                            <input value={editName} onChange={e => setEditName(e.target.value)}
                              className="flex-1 bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-3 py-1.5 outline-none" placeholder="Name" />
                            <input value={editRole} onChange={e => setEditRole(e.target.value)}
                              className="flex-1 bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-3 py-1.5 outline-none" placeholder="Role" />
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <p className="font-semibold text-[#2D2D2D] truncate">{m.name}</p>
                            {m.role && <p className="text-xs text-[#6B6B6B]">{m.role}</p>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isEditing ? (
                          <>
                            <button onClick={() => { onUpdate(m.id, { name: editName.trim(), role: editRole.trim() }); setEditingId(null) }}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg text-white" style={{ backgroundColor: BRAND }}>Save</button>
                            <button onClick={() => setEditingId(null)} className="text-xs text-[#6B6B6B]">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(m.id); setEditName(m.name); setEditRole(m.role) }}
                              className="text-xs text-[#6B6B6B] hover:text-[#4A4A4A] px-2 py-1 rounded hover:bg-[#FEFDFB]">Edit</button>
                            <button onClick={() => { setDeleteTarget(m); setDeleteConfirmText('') }}
                              className="text-[#D4D4D4] hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-[#6B6B6B]">
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />{m.posts.length} posts loaded</span>
                      {m.icpSignals.length > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />{m.icpSignals.length} ICP signals</span>}
                      {latest && <span className="text-[#D4D4D4]">Latest: {monthLabel(latest)} · {fmtN(latestImpressions)} impr.</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <MiniDropZone label="Update Analytics (90d)" onFile={(f, cb) => handleUpdateFile(m.id, f, 'posts', cb)} />
                      <MiniDropZone label="Update ICP Signals" onFile={(f, cb) => handleUpdateFile(m.id, f, 'icp', cb)} />
                      <button onClick={() => { setEditGoalsId(editGoalsId === m.id ? null : m.id); setDraftGoals(goals[m.id] ?? DEFAULT_GOALS) }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer"
                        style={editGoalsId === m.id ? { borderColor: BRAND, backgroundColor: '#F4ECED', color: BRAND } : { borderColor: '#E8ECF0', backgroundColor: 'white', color: '#78716C' }}>
                        <BarChart2 className="w-3.5 h-3.5" style={{ color: editGoalsId === m.id ? BRAND : '#C7BFB8' }} />
                        {editGoalsId === m.id ? 'Editing Goals' : 'Edit Goals'}
                      </button>
                    </div>
                    {editGoalsId === m.id && (
                      <div className="mt-3 pt-3 border-t border-[#EEF1F5]">
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {([['monthlyPosts', 'Posts/mo'], ['monthlyImpressions', 'Impressions/mo'], ['monthlyFollowers', 'Followers/mo'], ['monthlyIcpSignals', 'ICP Signals/mo']] as const).map(([key, label]) => (
                            <div key={key}>
                              <label className="text-[10px] text-[#6B6B6B] block mb-1">{label}</label>
                              <input type="number" value={draftGoals[key]} onChange={e => setDraftGoals(prev => ({ ...prev, [key]: parseInt(e.target.value) || 0 }))}
                                className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-2.5 py-1.5 outline-none" />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { onMemberGoalChange(m.id, draftGoals); setEditGoalsId(null) }}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: BRAND }}>Save Goals</button>
                          <button onClick={() => setEditGoalsId(null)} className="text-xs text-[#6B6B6B]">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!showAddForm ? (
          <button onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 border-2 border-dashed border-[#E8ECF0] rounded-xl text-sm text-[#6B6B6B] hover:border-[#C7BFB8] hover:text-[#4A4A4A] transition-colors bg-white">
            <Plus className="w-4 h-4" />Add team member
          </button>
        ) : (
          <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">New Member</p>
              <button onClick={() => { setShowAddForm(false); setNewName(''); setNewRole(''); setNewPosts([]); setNewPostsLoaded(false); setNewIcpSignals([]); setNewIcpLoaded(false); setNewFollowerHistory([]) }}
                className="text-[#D4D4D4] hover:text-[#4A4A4A]"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-[#6B6B6B] block mb-1.5">Full Name *</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Daryl Smith"
                  className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#D4D4D4]" />
              </div>
              <div>
                <label className="text-xs text-[#6B6B6B] block mb-1.5">Role</label>
                <input type="text" value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="e.g. Loan Officer"
                  className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#D4D4D4]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <UploadCard type="posts" label="LinkedIn Analytics" hint="Required · CSV or XLSX · 90-day export" loaded={newPostsLoaded} onFile={handleNewFile} />
              <UploadCard type="icp" label="ICP Signals" hint="Optional · provided by notus" loaded={newIcpLoaded} onFile={handleNewFile} />
            </div>
            {addError && <p className="text-xs text-red-500 mb-3">{addError}</p>}
            <button onClick={addMember} disabled={!newName.trim() || !newPostsLoaded || adding}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: BRAND }}>
              {adding ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        )}

        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">Org ICP Signals</p>
              <p className="text-xs text-[#6B6B6B] mt-0.5">Not attributed to a specific member</p>
            </div>
            {orgIcpSignals.length > 0 && (
              <button onClick={() => setConfirmClearIcp(true)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors">Clear</button>
            )}
          </div>
          {orgIcpSignals.length > 0 && (
            <p className="text-xs text-[#6B6B6B] mb-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block flex-shrink-0" />
              {orgIcpSignals.length} signals · {orgIcpSignals.filter(s => s.isIcp).length} confirmed ICP
            </p>
          )}
          <MiniDropZone
            label={orgIcpSignals.length > 0 ? 'Replace Org ICP Signals' : 'Upload Org ICP Signals'}
            onFile={(f, cb) => {
              parseICPFile(f).then(signals => {
                onOrgIcpUpload(signals).then(() => cb(true)).catch(err => cb(false, (err as Error).message))
              }).catch(err => cb(false, (err as Error).message))
            }}
          />
        </div>

        <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden">
          <button onClick={() => setShowGoalPanel(s => !s)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm text-[#4A4A4A] hover:text-[#2D2D2D] transition-colors">
            <span className="flex items-center gap-2"><BarChart2 className="w-4 h-4 text-[#D4D4D4]" />How to set LinkedIn goals</span>
            <ChevronDown className={`w-4 h-4 text-[#D4D4D4] transition-transform ${showGoalPanel ? 'rotate-180' : ''}`} />
          </button>
          {showGoalPanel && (
            <div className="px-5 pb-5 border-t border-[#EEF1F5] pt-4 space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: BRAND }}>Set goals from Shield Index benchmarks</p>
                <p className="text-xs text-[#6B6B6B] mb-3">Select a target tier and follower bracket. Goals auto-calculate based on LinkedIn industry benchmarks (Shield Index, Jan 2026).</p>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] text-[#6B6B6B] block mb-1">Target Tier</label>
                    <select value={shieldTier} onChange={e => setShieldTier(e.target.value as 'typical' | 'strong' | 'top')}
                      className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-2.5 py-2 outline-none">
                      <option value="typical">Top 50% (Typical)</option>
                      <option value="strong">Top 25% (Strong)</option>
                      <option value="top">Top 10% (Top)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#6B6B6B] block mb-1">Follower Bracket</label>
                    <select value={shieldBracket} onChange={e => setShieldBracket(parseInt(e.target.value))}
                      className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-2.5 py-2 outline-none">
                      {SHIELD_INDEX.brackets.map((b, i) => <option key={i} value={i}>{b.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#6B6B6B] block mb-1">Posts / person / month</label>
                    <input type="number" value={shieldPosts} onChange={e => setShieldPosts(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-2.5 py-2 outline-none" />
                  </div>
                </div>
                {(() => {
                  const bracket = SHIELD_INDEX.brackets[shieldBracket]
                  const impPerPost = bracket[shieldTier]
                  const calcGoals: MemberGoals = {
                    monthlyPosts: shieldPosts,
                    monthlyImpressions: shieldPosts * impPerPost,
                    monthlyFollowers: SHIELD_INDEX.followerGrowth[shieldTier],
                    monthlyIcpSignals: 20,
                  }
                  return (
                    <div className="bg-[#FAF8F3] rounded-lg px-4 py-3 mb-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-2">Preview</p>
                      <div className="grid grid-cols-4 gap-3 text-sm">
                        <div><span className="text-[#6B6B6B] text-xs block">Posts</span><span className="font-semibold text-[#2D2D2D]">{calcGoals.monthlyPosts}/mo</span></div>
                        <div><span className="text-[#6B6B6B] text-xs block">Impressions</span><span className="font-semibold text-[#2D2D2D]">{fmtN(calcGoals.monthlyImpressions)}/mo</span></div>
                        <div><span className="text-[#6B6B6B] text-xs block">Followers</span><span className="font-semibold text-[#2D2D2D]">+{calcGoals.monthlyFollowers}/mo</span></div>
                        <div><span className="text-[#6B6B6B] text-xs block">ICP Signals</span><span className="font-semibold text-[#2D2D2D]">{calcGoals.monthlyIcpSignals}/mo</span></div>
                      </div>
                      <p className="text-[10px] text-[#6B6B6B] mt-2">Based on {fmtN(impPerPost)} impressions/post ({bracket.label}, {shieldTier === 'typical' ? 'Top 50%' : shieldTier === 'strong' ? 'Top 25%' : 'Top 10%'})</p>
                    </div>
                  )
                })()}
                <button onClick={() => {
                  const bracket = SHIELD_INDEX.brackets[shieldBracket]
                  const impPerPost = bracket[shieldTier]
                  onBulkGoals({
                    monthlyPosts: shieldPosts,
                    monthlyImpressions: shieldPosts * impPerPost,
                    monthlyFollowers: SHIELD_INDEX.followerGrowth[shieldTier],
                    monthlyIcpSignals: 20,
                  })
                }}
                  className="text-sm font-medium px-4 py-2 rounded-lg text-white" style={{ backgroundColor: BRAND }}>
                  Apply to all {members.length} members
                </button>
              </div>
            </div>
          )}
        </div>

        {members.length > 0 && (
          <button onClick={onDone} className="w-full py-3 rounded-xl text-sm font-medium border border-[#E8ECF0] text-[#4A4A4A] hover:bg-white transition-colors">
            Done — Back to Dashboard
          </button>
        )}
      </main>

      {pendingUpload && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E8ECF0] p-6 max-w-sm w-full shadow-xl">
            <p className="text-sm font-semibold text-[#2D2D2D] mb-1">Review Upload</p>
            <p className="text-xs text-[#6B6B6B] mb-4">Updating {pendingUpload.memberName}</p>

            <div className="space-y-2 mb-4">
              {pendingUpload.summary.postCount > 0 && (
                <div className="bg-[#FAF8F3] rounded-lg px-3 py-2">
                  <p className="text-sm font-medium text-[#2D2D2D]">{pendingUpload.summary.postCount} posts</p>
                  {pendingUpload.summary.dateRange && <p className="text-xs text-[#6B6B6B]">{pendingUpload.summary.dateRange}</p>}
                  <p className="text-xs text-[#6B6B6B]">{fmtN(pendingUpload.summary.totalImpressions)} total impressions</p>
                </div>
              )}
              {pendingUpload.summary.followerMonths > 0 && (
                <p className="text-xs text-[#6B6B6B]">{pendingUpload.summary.followerMonths} months of follower data</p>
              )}
              {pendingUpload.summary.noFollowerData && (
                <p className="text-xs text-amber-600">Note: no follower data found in this file.</p>
              )}
              {pendingUpload.summary.signalCount > 0 && (
                <div className="bg-[#FAF8F3] rounded-lg px-3 py-2">
                  <p className="text-sm font-medium text-[#2D2D2D]">{pendingUpload.summary.signalCount} ICP signals</p>
                </div>
              )}
            </div>

            {pendingUpload.warning && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                <p className="text-xs text-amber-800">{pendingUpload.warning}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setPendingUpload(null); pendingUpload.onResult(false) }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-[#E8ECF0] text-[#4A4A4A]">
                Cancel
              </button>
              <button onClick={() => {
                const { memberId, memberName, data, onResult } = pendingUpload
                setPendingUpload(null)
                onUpdateWithUndo(memberId, data, memberName)
                onResult(true, pendingUpload.summary.noFollowerData ? 'Updated (no follower data in file)' : undefined)
              }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: BRAND }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClearIcp && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E8ECF0] p-6 max-w-sm w-full shadow-xl">
            <p className="text-sm font-semibold text-[#2D2D2D] mb-1">Clear Org ICP Signals?</p>
            <p className="text-xs text-[#6B6B6B] mb-4">
              This will remove all {orgIcpSignals.length} org-level ICP signals. You&apos;ll have a few seconds to undo after confirming.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmClearIcp(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-[#E8ECF0] text-[#4A4A4A]">
                Cancel
              </button>
              <button onClick={() => { setConfirmClearIcp(false); onOrgIcpClear() }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors rounded-xl">
                Clear All Signals
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E8ECF0] p-6 max-w-sm w-full shadow-xl">
            <p className="text-sm font-semibold text-[#2D2D2D] mb-1">Remove {deleteTarget.name}?</p>
            <p className="text-xs text-[#6B6B6B] mb-4">This will permanently delete:</p>
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4 space-y-1">
              {deleteTarget.posts.length > 0 && (
                <p className="text-xs text-red-800">{deleteTarget.posts.length} posts ({fmtN(deleteTarget.posts.reduce((s, p) => s + p.impressions, 0))} impressions)</p>
              )}
              {deleteTarget.icpSignals.length > 0 && (
                <p className="text-xs text-red-800">{deleteTarget.icpSignals.length} ICP signals</p>
              )}
              {deleteTarget.followerHistory.length > 0 && (
                <p className="text-xs text-red-800">{deleteTarget.followerHistory.length} months of follower data</p>
              )}
              <p className="text-xs text-red-800">All goals and settings</p>
            </div>
            <p className="text-xs text-[#6B6B6B] mb-2">
              Type <span className="font-semibold text-[#2D2D2D]">{deleteTarget.name.split(' ')[0].toLowerCase()}</span> to confirm:
            </p>
            <input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-3 py-2 outline-none mb-4"
              placeholder={deleteTarget.name.split(' ')[0].toLowerCase()}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-[#E8ECF0] text-[#4A4A4A]">
                Cancel
              </button>
              <button
                onClick={() => { onDelete(deleteTarget.id); setDeleteTarget(null) }}
                disabled={deleteConfirmText.toLowerCase() !== deleteTarget.name.split(' ')[0].toLowerCase()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: deleteConfirmText.toLowerCase() === deleteTarget.name.split(' ')[0].toLowerCase() ? '#DC2626' : '#E8ECF0',
                  color: deleteConfirmText.toLowerCase() === deleteTarget.name.split(' ')[0].toLowerCase() ? 'white' : '#D4D4D4',
                }}>
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ICP Signal Table (member view) ───────────────────────────────────────────

function ICPSignalTable({ signals, monthLabel: label }: { signals: ICPSignal[]; monthLabel: string }) {
  const sorted = useMemo(() =>
    [...signals].sort((a, b) => (parseFlexDate(b.date)?.getTime() ?? 0) - (parseFlexDate(a.date)?.getTime() ?? 0))
  , [signals])
  const actionCounts: Record<string, number> = {}
  signals.forEach(s => { actionCounts[s.action] = (actionCounts[s.action] || 0) + 1 })
  const actionBreakdown = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])

  return (
    <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#EEF1F5]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">ICP Signals — {label}</p>
      </div>
      {sorted.length === 0 ? (
        <p className="px-5 py-6 text-xs text-center text-[#6B6B6B]">No ICP signals this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[#FEFDFB]">
              {['Date', 'Name', 'Company', 'Title', 'Action'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={i} className="border-b border-[#FEFDFB] hover:bg-[#FAF8F3] transition-colors last:border-0">
                  <td className="px-4 py-2.5 text-[#6B6B6B] whitespace-nowrap">{s.date}</td>
                  <td className="px-4 py-2.5 font-medium text-[#2D2D2D]">{s.name || '—'}</td>
                  <td className="px-4 py-2.5 text-[#4A4A4A]">{s.company || '—'}</td>
                  <td className="px-4 py-2.5 text-[#6B6B6B]">{s.title || '—'}</td>
                  <td className="px-4 py-2.5 capitalize text-[#4A4A4A]">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {actionBreakdown.length > 0 && (
        <div className="px-5 py-4 border-t border-[#EEF1F5] bg-[#FAF8F3]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-3">By Action</p>
          <div className="space-y-2">
            {actionBreakdown.map(([action, count]) => (
              <div key={action} className="flex items-center gap-3">
                <span className="text-xs text-[#4A4A4A] capitalize w-24 flex-shrink-0">{action}</span>
                <div className="flex-1 h-1.5 bg-[#EEF1F5] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(count / actionBreakdown[0][1]) * 100}%`, backgroundColor: BRAND }} />
                </div>
                <span className="text-xs font-medium text-[#2D2D2D] w-5 text-right flex-shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ICP Overview (leaderboard section) ──────────────────────────────────────

function ICPOverview({ members, orgIcpSignals }: { members: Member[]; orgIcpSignals: ICPSignal[] }) {
  const combined = useMemo(() => allSignals(members, orgIcpSignals), [members, orgIcpSignals])
  if (combined.length === 0) return null

  const total = combined.length

  const companyCounts = useMemo(() => {
    const map: Record<string, number> = {}
    combined.forEach(s => { if (s.company) map[s.company] = (map[s.company] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [combined])

  const trendData = useMemo(() => {
    const byMonth: Record<string, number> = {}
    combined.forEach(s => { const d = parseFlexDate(s.date); if (!d) return; const mk = monthKey(d); byMonth[mk] = (byMonth[mk] || 0) + 1 })
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v > 0).slice(-12).map(([date, total]) => ({ date, total }))
  }, [combined])

  const topCompany = companyCounts[0]?.[0] ?? null

  return (
    <div className="space-y-4 pt-5 border-t border-[#EEF1F5]">
      <h2 className="text-lg font-semibold text-[#2D2D2D]">ICP Overview — All Time</h2>
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total ICP Signals" value={fmtN(total)} sub="All sources combined" />
        <StatCard label="Top Company" value={topCompany ?? '—'} sub={topCompany ? `${companyCounts[0][1]} signals` : 'No company data'} />
      </div>

      {trendData.length > 1 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">ICP Signal Trend</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trendData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={k => { const [y, m] = k.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' \'' + y.slice(2) }} />
              <YAxis tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8ECF0' }} />
              <CartesianGrid vertical={false} stroke="#EEF1F5" />
              <Line type="monotone" dataKey="total" stroke={BRAND} strokeWidth={2} dot={false} name="ICP Signals" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {companyCounts.length > 0 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Top Companies</p>
          <div className="space-y-2.5">
            {companyCounts.slice(0, 6).map(([company, ct]) => (
              <div key={company}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#4A4A4A] truncate flex-1 mr-2">{company}</span>
                  <span className="text-xs text-[#6B6B6B]">{ct}</span>
                </div>
                <div className="h-1 bg-[#EEF1F5] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(ct / companyCounts[0][1]) * 100}%`, backgroundColor: BRAND }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {members.length > 0 && (() => {
        const icpRows = members.map(m => {
          const memberSignals = m.icpSignals.length
          const attributedOrg = orgIcpSignals.filter(s => attributeOrgSignal(s, [m]) === m.name).length
          return { member: m, total: memberSignals + attributedOrg }
        }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)
        const maxIcp = icpRows[0]?.total ?? 1
        const unattributed = orgIcpSignals.filter(s => !attributeOrgSignal(s, members)).length

        if (icpRows.length === 0) return null
        return (
          <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF1F5]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">ICP Leaderboard — All Time</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#FEFDFB]">
                    {['#', 'Name', 'ICP Signals', 'Companies Reached'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {icpRows.map((row, i) => {
                    const memberCompanies = new Set([
                      ...row.member.icpSignals.map(s => s.company).filter(Boolean),
                      ...orgIcpSignals.filter(s => attributeOrgSignal(s, [row.member]) === row.member.name).map(s => s.company).filter(Boolean),
                    ])
                    return (
                      <tr key={row.member.id} className="border-b border-[#FEFDFB] hover:bg-[#FAF8F3] transition-colors">
                        <td className="px-5 py-4">
                          {i < 3 ? <span className="text-lg">{['🥇', '🥈', '🥉'][i]}</span> : <span className="text-sm text-[#D4D4D4] font-mono">#{i + 1}</span>}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                              style={{ backgroundColor: i === 0 ? BRAND : '#C7BFB8' }}>
                              {row.member.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-[#2D2D2D]">{row.member.name}</p>
                              {row.member.role && <p className="text-xs text-[#6B6B6B]">{row.member.role}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-semibold text-[#2D2D2D]">{row.total}</span>
                          <div className="mt-1.5 h-1 w-20 bg-[#EEF1F5] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(row.total / maxIcp) * 100}%`, backgroundColor: BRAND }} />
                          </div>
                        </td>
                        <td className="px-5 py-4 text-[#4A4A4A]">{memberCompanies.size}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {unattributed > 0 && (
              <div className="px-5 py-3 bg-[#FAF8F3] border-t border-[#EEF1F5]">
                <span className="text-[10px] text-[#D4D4D4]">+ {unattributed} unattributed signal{unattributed > 1 ? 's' : ''} (org-level, not matched to a member)</span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── ICP Pipeline View (dedicated tab) ────────────────────────────────────────

function ICPPipelineView({ members, orgIcpSignals }: { members: Member[]; orgIcpSignals: ICPSignal[] }) {
  const combined = useMemo(() => allSignals(members, orgIcpSignals), [members, orgIcpSignals])
  const [search, setSearch] = useState('')

  const total = combined.length

  const companyCounts = useMemo(() => {
    const map: Record<string, number> = {}
    combined.forEach(s => { if (s.company) map[s.company] = (map[s.company] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [combined])

  const trendData = useMemo(() => {
    const byMonth: Record<string, number> = {}
    combined.forEach(s => { const d = parseFlexDate(s.date); if (!d) return; const mk = monthKey(d); byMonth[mk] = (byMonth[mk] || 0) + 1 })
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v > 0).slice(-12).map(([date, total]) => ({ date, total }))
  }, [combined])

  const actionBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    combined.forEach(s => { map[s.action] = (map[s.action] || 0) + 1 })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [combined])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return [...combined]
      .filter(s => (s.name ?? '').toLowerCase().includes(q) || (s.company ?? '').toLowerCase().includes(q))
      .sort((a, b) => (parseFlexDate(b.date)?.getTime() ?? 0) - (parseFlexDate(a.date)?.getTime() ?? 0))
  }, [combined, search])

  if (combined.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <Zap className="w-8 h-8 mx-auto mb-3 text-[#D4D4D4]" />
          <p className="text-sm font-medium text-[#2D2D2D] mb-1">No ICP signals yet</p>
          <p className="text-xs text-[#6B6B6B]">Upload signals via Manage → team members or Org ICP Signals</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total ICP Signals" value={fmtN(total)} sub="All time · all sources" />
        <StatCard label="Companies Reached" value={companyCounts.length.toString()} sub={companyCounts[0] ? `Top: ${companyCounts[0][0]}` : 'No company data'} />
      </div>

      {trendData.length > 1 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Monthly Trend</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trendData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={k => { const [y, m] = k.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' \'' + y.slice(2) }} />
              <YAxis tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8ECF0' }} />
              <CartesianGrid vertical={false} stroke="#EEF1F5" />
              <Line type="monotone" dataKey="total" stroke={BRAND} strokeWidth={2} dot={false} name="ICP Signals" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {actionBreakdown.length > 0 && (
          <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Signal Types</p>
            <div className="space-y-3">
              {actionBreakdown.slice(0, 7).map(([action, count]) => (
                <div key={action}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#4A4A4A] capitalize">{action}</span>
                    <span className="text-xs font-semibold text-[#2D2D2D]">{count}</span>
                  </div>
                  <div className="h-1.5 bg-[#EEF1F5] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(count / actionBreakdown[0][1]) * 100}%`, backgroundColor: BRAND }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {companyCounts.length > 0 && (
          <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Top Companies</p>
            <div className="space-y-3">
              {companyCounts.slice(0, 7).map(([company, ct]) => (
                <div key={company}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#4A4A4A] truncate flex-1 mr-2">{company}</span>
                    <span className="text-xs font-semibold text-[#2D2D2D]">{ct}</span>
                  </div>
                  <div className="h-1.5 bg-[#EEF1F5] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(ct / companyCounts[0][1]) * 100}%`, backgroundColor: BRAND }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#EEF1F5] flex items-center gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] flex-shrink-0">Search Signals</p>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or company…"
            className="bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-xs rounded-lg px-3 py-1.5 outline-none flex-1 placeholder:text-[#D4D4D4]" />
        </div>
        {!search.trim() ? (
          <div className="px-5 py-8 text-center text-xs text-[#6B6B6B]">{total} signals total — type a name or company to search</div>
        ) : searchResults.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-[#6B6B6B]">No signals found for &ldquo;{search}&rdquo;</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#FEFDFB]">
                  {['Date', 'Name', 'Company', 'Title', 'Action', 'LinkedIn'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {searchResults.map((s, i) => (
                  <tr key={i} className="border-b border-[#FEFDFB] hover:bg-[#FAF8F3] transition-colors last:border-0">
                    <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{s.date}</td>
                    <td className="px-4 py-3 font-medium text-[#2D2D2D]">{s.name || '—'}</td>
                    <td className="px-4 py-3 text-[#4A4A4A]">{s.company || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{s.title || '—'}</td>
                    <td className="px-4 py-3 capitalize text-[#4A4A4A]">{s.action}</td>
                    <td className="px-4 py-3">
                      {s.source
                        ? <a href={s.source} target="_blank" rel="noopener noreferrer" className="text-[#722F37] underline underline-offset-2 hover:opacity-70 transition-opacity">View</a>
                        : <span className="text-[#D4D4D4]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function LeaderboardView({ members, selectedMonth, orgIcpSignals }: { members: Member[]; selectedMonth: string; orgIcpSignals?: ICPSignal[] }) {
  const isAllTime = selectedMonth === 'all'
  const orgIcpFiltered = useMemo(() => {
    if (!orgIcpSignals) return []
    return isAllTime ? orgIcpSignals : icpForMonth(orgIcpSignals, selectedMonth)
  }, [orgIcpSignals, selectedMonth, isAllTime])

  const rows = useMemo(() => {
    return members.map(m => {
      const mp = isAllTime ? m.posts : postsForMonth(m.posts, selectedMonth)
      const mf = isAllTime
        ? m.followerHistory.reduce((s, f) => s + f.newFollowers, 0)
        : followerGrowthForMonth(m.posts, m.followerHistory, selectedMonth)
      const memberIcp = isAllTime ? m.icpSignals : icpForMonth(m.icpSignals, selectedMonth)
      const attributedOrg = orgIcpFiltered.filter(s => attributeOrgSignal(s, [m]) === m.name)
      const icpTotal = memberIcp.length + attributedOrg.length
      const impressions = mp.reduce((s, p) => s + p.impressions, 0)
      const avgPerPost = mp.length > 0 ? impressions / mp.length : 0
      const avgEng = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
      const t = tier(avgPerPost)
      return { member: m, postCount: mp.length, impressions, avgPerPost, avgEng, followers: mf, tier: t, icpTotal }
    }).sort((a, b) => b.impressions - a.impressions)
  }, [members, selectedMonth, orgIcpFiltered, isAllTime])

  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0)
  const totalPosts = rows.reduce((s, r) => s + r.postCount, 0)
  const totalFollowers = rows.reduce((s, r) => s + r.followers, 0)
  const unattributedIcp = orgIcpFiltered.filter(s => !attributeOrgSignal(s, members)).length
  const totalIcp = rows.reduce((s, r) => s + r.icpTotal, 0) + unattributedIcp
  const maxImpressions = Math.max(...rows.map(r => r.impressions), 1)
  const hasIcp = rows.some(r => r.icpTotal > 0) || orgIcpFiltered.length > 0
  const periodLabel = isAllTime ? 'All Time' : monthLabel(selectedMonth)

  const impressionsTrend = useMemo(() => {
    const byMonth: Record<string, number> = {}
    members.forEach(m => m.posts.forEach(p => {
      const d = parseFlexDate(p.date); if (!d) return
      const mk = monthKey(d)
      byMonth[mk] = (byMonth[mk] || 0) + p.impressions
    }))
    // Find where meaningful activity starts: first month with 500+ total impressions
    const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
    const startIdx = sorted.findIndex(([, v]) => v >= 500)
    return sorted.slice(startIdx >= 0 ? startIdx : 0).filter(([, v]) => v > 0).map(([date, impressions]) => ({ date, impressions }))
  }, [members])

  return (
    <div className="space-y-5">
      <div className={`grid grid-cols-2 gap-4 ${hasIcp ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <StatCard label="Team Impressions" value={fmtN(totalImpressions)} sub={`${members.length} members · ${periodLabel}`} />
        <StatCard label="Posts Published" value={totalPosts.toString()} sub={`${fmtN(totalImpressions / Math.max(totalPosts, 1))} avg impressions / post`} />
        <StatCard label="Follower Growth" value={`+${fmtN(totalFollowers)}`} sub={periodLabel} />
        {hasIcp && <StatCard label="ICP Signals" value={fmtN(totalIcp)} sub={unattributedIcp > 0 ? `incl. ${unattributedIcp} unattributed` : `Total signals · ${periodLabel}`} />}
      </div>

      {impressionsTrend.length > 1 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Impressions Trend</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={impressionsTrend}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={k => { const [y, m] = k.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' \'' + y.slice(2) }} />
              <YAxis tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={fmtN} width={36} />
              <Tooltip formatter={(v: number) => [fmtN(v), 'Impressions']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8ECF0' }} />
              <CartesianGrid vertical={false} stroke="#EEF1F5" />
              <Line type="monotone" dataKey="impressions" stroke={BRAND} strokeWidth={2} dot={false} name="Impressions" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white border border-[#E8ECF0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EEF1F5]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">Leaderboard — {periodLabel}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#FEFDFB]">
                {['#', 'Name', 'Posts', 'Total Impressions', 'Avg / Post', 'Followers', 'Eng. Rate', ...(hasIcp ? ['ICP Signals'] : []), 'Tier'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.member.id} className="border-b border-[#FEFDFB] hover:bg-[#FAF8F3] transition-colors">
                  <td className="px-5 py-4">
                    {i < 3 ? <span className="text-lg">{['🥇', '🥈', '🥉'][i]}</span> : <span className="text-sm text-[#D4D4D4] font-mono">#{i + 1}</span>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                        style={{ backgroundColor: i === 0 ? BRAND : '#C7BFB8' }}>
                        {row.member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-[#2D2D2D]">{row.member.name}</p>
                        {row.member.role && <p className="text-xs text-[#6B6B6B]">{row.member.role}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#4A4A4A]">{row.postCount}</td>
                  <td className="px-5 py-4">
                    <span className="font-semibold text-[#2D2D2D]">{fmtN(row.impressions)}</span>
                    <div className="mt-1.5 h-1 w-20 bg-[#EEF1F5] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(row.impressions / maxImpressions) * 100}%`, backgroundColor: BRAND }} />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#4A4A4A]">{row.postCount > 0 ? fmtN(row.avgPerPost) : '—'}</td>
                  <td className="px-5 py-4 text-green-700 font-medium">{row.followers > 0 ? `+${fmtN(row.followers)}` : '—'}</td>
                  <td className="px-5 py-4 text-[#4A4A4A]">{row.postCount > 0 ? fmtPct(row.avgEng) : '—'}</td>
                  {hasIcp && (
                    <td className="px-5 py-4">
                      {row.icpTotal > 0 ? (
                        <span className="font-medium text-[#2D2D2D]">{row.icpTotal}</span>
                      ) : '—'}
                    </td>
                  )}
                  <td className="px-5 py-4">
                    {row.postCount > 0 && (
                      <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: row.tier.bg, color: row.tier.color }}>
                        {row.tier.label}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-[#FAF8F3] border-t border-[#EEF1F5] flex flex-wrap gap-x-5 gap-y-1">
          <span className="text-[10px] text-[#D4D4D4]">notus benchmark (50K posts)</span>
          <span className="text-[10px] text-[#D4D4D4]"><span style={{ color: BRAND }}>●</span> Top 10% = {fmtN(BENCHMARKS.top10PerPost)}/post</span>
          <span className="text-[10px] text-[#D4D4D4]"><span className="text-green-500">●</span> Top 25% = {fmtN(BENCHMARKS.top25PerPost)}/post</span>
          <span className="text-[10px] text-[#D4D4D4]"><span className="text-amber-500">●</span> Top 50% = {fmtN(BENCHMARKS.medianPerPost)}/post</span>
        </div>
      </div>
      <ICPOverview members={members} orgIcpSignals={orgIcpSignals ?? []} />
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
  const mf = useMemo(() => followerGrowthForMonth(member.posts, member.followerHistory, selectedMonth), [member.posts, member.followerHistory, selectedMonth])
  const icpMonth = useMemo(() => icpForMonth(member.icpSignals, selectedMonth), [member.icpSignals, selectedMonth])

  const prevMonthIdx = months.indexOf(selectedMonth) + 1
  const prevMonth = months[prevMonthIdx] ?? null
  const prevMp = useMemo(() => prevMonth ? postsForMonth(member.posts, prevMonth) : [], [member.posts, prevMonth])
  const prevMf = useMemo(() => prevMonth ? followerGrowthForMonth(member.posts, member.followerHistory, prevMonth) : 0, [member.posts, member.followerHistory, prevMonth])
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

  const icpByAction = useMemo(() => {
    const counts: Record<string, number> = {}
    icpMonth.forEach(s => { counts[s.action] = (counts[s.action] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [icpMonth])

  const followerChartData = useMemo(() => {
    const byMonth: Record<string, number> = {}
    const source = member.followerHistory.length > 0 ? member.followerHistory : []
    if (source.length > 0) {
      source.forEach(f => { const d = parseFlexDate(f.date); if (d) { const mk = monthKey(d); byMonth[mk] = (byMonth[mk] || 0) + f.newFollowers } })
    } else {
      member.posts.forEach(p => { const d = parseFlexDate(p.date); if (d) { const mk = monthKey(d); byMonth[mk] = (byMonth[mk] || 0) + p.follows } })
    }
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v > 0).map(([date, newFollowers]) => ({ date, newFollowers }))
  }, [member.posts, member.followerHistory])

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: BRAND }}>
            {member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h2 className="text-xl font-semibold text-[#2D2D2D]">{member.name}</h2>
              {avgPerPost > 0 && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: memberTier.bg, color: memberTier.color }}>
                  {memberTier.label} Creator
                </span>
              )}
            </div>
            {member.role && <p className="text-sm text-[#6B6B6B]">{member.role}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#6B6B6B]">Viewing</span>
          <div className="relative">
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg pl-3 pr-8 py-2 outline-none cursor-pointer appearance-none">
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-[#D4D4D4] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-4 ${hasIcp ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <StatCard label="Impressions" value={fmtN(totalImpressions)}
          trend={impDiff !== null ? { text: `${Math.abs(impDiff).toFixed(0)}% vs prev month`, positive: impDiff >= 0 } : null}
          sub={`${mp.length} posts · ${fmtN(avgPerPost)}/post`} />
        <StatCard label="Follower Growth" value={`+${fmtN(mf)}`}
          trend={follDiff !== null ? { text: `${Math.abs(follDiff).toFixed(0)}% vs prev month`, positive: follDiff >= 0 } : null}
          sub={monthLabel(selectedMonth)} />
        <StatCard label="Engagement Rate" value={mp.length > 0 ? fmtPct(avgEngRate) : '—'}
          sub={mp.length > 0 ? `Benchmark top 25% = ${BENCHMARKS.top25EngRate}%` : 'No posts this month'} />
        {hasIcp && <StatCard label="ICP Signals" value={icpMonth.length.toString()}
          trend={icpDiff !== null ? { text: `${Math.abs(icpDiff).toFixed(0)}% vs prev month`, positive: icpDiff >= 0 } : null}
          sub={icpMatched > 0 ? `${icpMatched} confirmed ICP match${icpMatched > 1 ? 'es' : ''}` : 'No ICP matches yet'} />}
      </div>

      {mp.length > 0 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Post Impressions — {monthLabel(selectedMonth)}</p>
          {mp.length <= 4 ? (
            <div className="space-y-3">
              {chartData.map(p => {
                const max = Math.max(...chartData.map(d => d.impressions), 1)
                return (
                  <div key={p.i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[#4A4A4A]">Post {p.i}</span>
                      <span className="text-xs font-semibold text-[#2D2D2D]">{fmtN(p.impressions)} impressions</span>
                    </div>
                    <div className="h-2.5 bg-[#EEF1F5] rounded-full overflow-hidden relative">
                      <div className="h-full rounded-full" style={{ width: `${(p.impressions / max) * 100}%`, backgroundColor: BRAND }} />
                      {BENCHMARKS.top25PerPost <= max && (
                        <div className="absolute top-0 bottom-0 w-px bg-green-500 opacity-50" style={{ left: `${(BENCHMARKS.top25PerPost / max) * 100}%` }} />
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center gap-4 pt-1">
                <span className="flex items-center gap-1.5 text-[10px] text-[#A8A29E]"><span className="w-2 h-px bg-green-500 inline-block" /> Top 25%: {fmtN(BENCHMARKS.top25PerPost)}</span>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barSize={Math.min(32, Math.max(12, 300 / chartData.length))}>
                <XAxis dataKey="i" tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} label={{ value: 'Post #', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#A8A29E' }} />
                <YAxis tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={fmtN} width={36} />
                <Tooltip formatter={(v: number) => [fmtN(v), 'Impressions']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8ECF0' }} />
                <ReferenceLine y={BENCHMARKS.top25PerPost} stroke="#16A34A" strokeDasharray="3 3" strokeWidth={1} />
                <ReferenceLine y={BENCHMARKS.top10PerPost} stroke={BRAND} strokeDasharray="3 3" strokeWidth={1} />
                <Bar dataKey="impressions" fill={BRAND} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {followerChartData.length > 1 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-4">Follower Growth — Monthly</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={followerChartData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={k => { const [y, m] = k.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' \'' + y.slice(2) }} />
              <YAxis tick={{ fontSize: 10, fill: '#A8A29E' }} axisLine={false} tickLine={false} tickFormatter={fmtN} width={36} />
              <Tooltip formatter={(v: number) => [`+${fmtN(v)}`, 'New Followers']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8ECF0' }} />
              <CartesianGrid vertical={false} stroke="#EEF1F5" />
              <Line type="monotone" dataKey="newFollowers" stroke={BRAND} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B]">Monthly Goals</p>
          {!editingGoals ? (
            <button onClick={() => { setDraftGoals(goals); setEditingGoals(true) }} className="text-xs text-[#6B6B6B] hover:text-[#4A4A4A]">Edit</button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { onGoalsChange(draftGoals); setEditingGoals(false) }} className="text-xs font-medium text-white px-2.5 py-1 rounded-lg" style={{ backgroundColor: BRAND }}>Save</button>
              <button onClick={() => setEditingGoals(false)} className="text-xs text-[#6B6B6B]">Cancel</button>
            </div>
          )}
        </div>
        {editingGoals ? (
          <div className="grid grid-cols-2 gap-3">
            {(['monthlyPosts', 'monthlyImpressions', 'monthlyFollowers', 'monthlyIcpSignals'] as const).map(k => (
              <div key={k}>
                <label className="text-xs text-[#6B6B6B] block mb-1">{k === 'monthlyPosts' ? 'Posts / month' : k === 'monthlyImpressions' ? 'Impressions / month' : k === 'monthlyFollowers' ? 'New Followers / month' : 'ICP Signals / month'}</label>
                <input type="number" value={draftGoals[k]} onChange={e => setDraftGoals(prev => ({ ...prev, [k]: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-[#FAF8F3] border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg px-3 py-2 outline-none" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <GoalBar label="Posts" current={mp.length} goal={goals.monthlyPosts} pace={pace} />
            <GoalBar label="Impressions" current={totalImpressions} goal={goals.monthlyImpressions} pace={pace} />
            <GoalBar label="Follower Growth" current={mf} goal={goals.monthlyFollowers} pace={pace} />
            {hasIcp && <GoalBar label="ICP Signals" current={icpMonth.length} goal={goals.monthlyIcpSignals} pace={pace} />}
          </div>
        )}
      </div>

      {topPost && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-3">Top Post — {monthLabel(selectedMonth)}</p>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: BRAND_LIGHT }}>
              <Star className="w-4 h-4" style={{ color: BRAND }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-4 mb-2">
                <span className="text-sm"><span className="font-semibold text-[#2D2D2D]">{fmtN(topPost.impressions)}</span> <span className="text-[#6B6B6B] text-xs">impressions</span></span>
                {topPost.engagements > 0 && <span className="text-sm"><span className="font-semibold text-[#2D2D2D]">{fmtN(topPost.engagements)}</span> <span className="text-[#6B6B6B] text-xs">engagements</span></span>}
                <span className="text-sm text-[#6B6B6B] text-xs">{topPost.date}</span>
              </div>
              {topPost.url && (
                <a href={topPost.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs truncate block max-w-xs hover:underline" style={{ color: BRAND }}>
                  {topPost.url.replace('https://www.linkedin.com', '').substring(0, 60)}…
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {insights.length > 0 && (
        <div className="bg-white border border-[#E8ECF0] rounded-xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B6B6B] mb-3">Insights</p>
          <div className="space-y-2.5">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: BRAND }} />
                <p className="text-sm text-[#2D2D2D] leading-relaxed">{ins}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasIcp && icpMonth.length > 0 && (
        <ICPSignalTable signals={icpMonth} monthLabel={monthLabel(selectedMonth)} />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrgPage({ params }: { params: { slug: string } }) {
  const { slug } = params
  const searchParams = useSearchParams()

  // API key auth: read from URL ?key=..., persist in localStorage
  const apiKey = useMemo(() => {
    const fromUrl = searchParams.get('key')
    if (fromUrl) {
      try { localStorage.setItem(`dashboard_key_${slug}`, fromUrl) } catch {}
      return fromUrl
    }
    try { return localStorage.getItem(`dashboard_key_${slug}`) ?? '' } catch { return '' }
  }, [slug, searchParams])

  const authFetch = useCallback((url: string, opts: RequestInit = {}) => {
    const headers = new Headers(opts.headers)
    if (apiKey) headers.set('x-api-key', apiKey)
    if (!headers.has('Content-Type') && opts.body && typeof opts.body === 'string') {
      headers.set('Content-Type', 'application/json')
    }
    return fetch(url, { ...opts, headers })
  }, [apiKey])

  const [members, setMembers] = useState<Member[]>([])
  const [goals, setGoals] = useState<Goals>({})
  const [orgName, setOrgName] = useState('')
  const [view, setView] = useState<'manage' | 'dashboard'>('manage')
  const [activeTab, setActiveTab] = useState<string>('leaderboard')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [orgIcpSignals, setOrgIcpSignals] = useState<ICPSignal[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // ─── Undo system ───────────────────────────────────────────────────────────
  const undoRef = useRef<{
    label: string
    execute: () => Promise<void>
    rollback: () => void
    timeoutId: ReturnType<typeof setTimeout>
    startedAt: number
    duration: number
  } | null>(null)
  const [undoAction, setUndoAction] = useState<{
    label: string; startedAt: number; duration: number
  } | null>(null)

  const scheduleUndo = useCallback((action: {
    label: string; duration?: number
    execute: () => Promise<void>; rollback: () => void
  }) => {
    // If an existing undo is pending, execute it immediately
    if (undoRef.current) {
      clearTimeout(undoRef.current.timeoutId)
      const pending = undoRef.current
      pending.execute().catch(err => {
        pending.rollback()
        setSaveError((err as Error).message || 'Action failed')
      })
    }

    const duration = action.duration ?? 7000
    const startedAt = Date.now()

    const timeoutId = setTimeout(() => {
      undoRef.current = null
      setUndoAction(null)
      action.execute().catch(err => {
        action.rollback()
        setSaveError((err as Error).message || 'Action failed')
      })
    }, duration)

    const entry = { ...action, timeoutId, startedAt, duration }
    undoRef.current = entry
    setUndoAction({ label: action.label, startedAt, duration })
  }, [])

  const cancelUndo = useCallback(() => {
    if (!undoRef.current) return
    clearTimeout(undoRef.current.timeoutId)
    undoRef.current.rollback()
    undoRef.current = null
    setUndoAction(null)
  }, [])

  useEffect(() => {
    return () => { if (undoRef.current) clearTimeout(undoRef.current.timeoutId) }
  }, [])

  useEffect(() => {
    if (!apiKey) { setError('Access denied — missing API key. Use the link provided by your admin.'); setLoading(false); return }
    authFetch(`/api/org/${slug}`)
      .then(r => { if (r.status === 401) throw new Error('Invalid API key'); return r.json() })
      .then(data => {
        if (data.error) { setError(data.error); return }
        setOrgName(data.org?.name ?? slug)
        setMembers(data.members ?? [])
        setGoals(data.goals ?? {})
        setOrgIcpSignals(data.orgIcpSignals ?? [])
        if ((data.members ?? []).length > 0) { setView('dashboard'); setActiveTab('leaderboard') }
      })
      .catch((e) => setError(e.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false))
  }, [slug, apiKey, authFetch])

  const allMonthsAcross = useMemo(() => {
    const byMonth: Record<string, number> = {}
    members.forEach(m => m.posts.forEach(p => {
      const d = parseFlexDate(p.date); if (!d) return
      const mk = monthKey(d)
      byMonth[mk] = (byMonth[mk] || 0) + p.impressions
    }))
    // Only show months with meaningful activity (500+ total impressions)
    return Object.entries(byMonth).filter(([, v]) => v >= 500).map(([k]) => k).sort().reverse()
  }, [members])

  const [selectedMonth, setSelectedMonth] = useState<string>('all')

  function handleUpdate(id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'posts' | 'icpSignals' | 'followerHistory'>>) {
    const prev = members
    setMembers(ms => ms.map(m => m.id === id ? { ...m, ...patch } : m))
    setSaveError('')
    authFetch(`/api/org/${slug}/members/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then(r => { if (!r.ok) throw new Error(`Save failed (${r.status})`) })
      .catch(e => { setMembers(prev); setSaveError(e.message || 'Failed to save changes') })
  }

  function handleUpdateWithUndo(id: string, patch: Partial<Pick<Member, 'posts' | 'icpSignals' | 'followerHistory'>>, memberName: string) {
    const prev = [...members]
    setMembers(ms => ms.map(m => m.id === id ? { ...m, ...patch } : m))
    setSaveError('')

    scheduleUndo({
      label: `Updated ${memberName.split(' ')[0]}`,
      duration: 10000,
      execute: async () => {
        const r = await authFetch(`/api/org/${slug}/members/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        if (!r.ok) throw new Error(`Save failed (${r.status})`)
      },
      rollback: () => { setMembers(prev) },
    })
  }

  function handleDelete(id: string) {
    const member = members.find(m => m.id === id)
    if (!member) return
    const prev = [...members]
    const prevTab = activeTab
    const prevGoals = { ...goals }

    setMembers(ms => {
      const updated = ms.filter(m => m.id !== id)
      if (updated.length === 0) setView('manage')
      else if (activeTab === id) setActiveTab('leaderboard')
      return updated
    })
    setSaveError('')

    scheduleUndo({
      label: `Removed ${member.name.split(' ')[0]}`,
      duration: 7000,
      execute: async () => {
        const r = await authFetch(`/api/org/${slug}/members/${id}`, { method: 'DELETE' })
        if (!r.ok) throw new Error(`Delete failed (${r.status})`)
      },
      rollback: () => {
        setMembers(prev)
        setActiveTab(prevTab)
        setGoals(prevGoals)
      },
    })
  }

  async function handleOrgIcpUpload(signals: ICPSignal[]) {
    const prev = orgIcpSignals
    setOrgIcpSignals(signals)
    const res = await authFetch(`/api/org/${slug}/org-icp`, {
      method: 'POST',
      body: JSON.stringify({ signals }),
    })
    if (!res.ok) {
      setOrgIcpSignals(prev)
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(body.error || `Save failed (${res.status})`)
    }
  }

  function handleOrgIcpClear() {
    const prev = orgIcpSignals
    const count = prev.length
    setOrgIcpSignals([])

    scheduleUndo({
      label: `Cleared ${count} ICP signals`,
      duration: 7000,
      execute: async () => {
        const res = await authFetch(`/api/org/${slug}/org-icp`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed to clear ICP signals')
      },
      rollback: () => { setOrgIcpSignals(prev) },
    })
  }

  async function handleAdd(data: NewMemberData) {
    const res = await authFetch(`/api/org/${slug}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to add member')
    const { id, addedAt } = await res.json()
    const newMember: Member = { id, addedAt, ...data }
    setMembers(prev => [...prev, newMember])
    setGoals(prev => ({ ...prev, [id]: { ...DEFAULT_GOALS } }))
  }

  function handleMemberGoalChange(memberId: string, g: MemberGoals) {
    const prevGoals = goals
    const newGoals = { ...goals, [memberId]: g }
    setGoals(newGoals)
    authFetch(`/api/org/${slug}/goals`, {
      method: 'PUT',
      body: JSON.stringify(newGoals),
    }).then(r => { if (!r.ok) throw new Error('Save failed') })
      .catch(() => { setGoals(prevGoals); setSaveError('Failed to save goals') })
  }

  function handleBulkGoals(g: MemberGoals) {
    const prevGoals = goals
    const newGoals: Goals = {}
    members.forEach(m => { newGoals[m.id] = g })
    setGoals(newGoals)
    authFetch(`/api/org/${slug}/goals`, {
      method: 'PUT',
      body: JSON.stringify(newGoals),
    }).then(r => { if (!r.ok) throw new Error('Save failed') })
      .catch(() => { setGoals(prevGoals); setSaveError('Failed to save goals') })
  }

  async function handleExportReport() {
    setExporting(true)
    try {
      const { generateReport } = await import('@/lib/generateReport')
      await generateReport({ orgName, selectedMonth, members, orgIcpSignals, goals })
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to generate report')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FEFDFB] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: BRAND }}>
            <span className="text-white font-bold text-xl leading-none" style={{ fontFamily: 'Georgia, serif' }}>n</span>
          </div>
          <p className="text-sm text-[#6B6B6B]">Loading dashboard…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FEFDFB] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-[#2D2D2D] mb-1">Dashboard not found</p>
          <p className="text-xs text-[#6B6B6B]">{error}</p>
        </div>
      </div>
    )
  }

  const undoToastEl = undoAction ? (
    <UndoToast label={undoAction.label} startedAt={undoAction.startedAt}
      duration={undoAction.duration} onUndo={cancelUndo} />
  ) : null

  if (view === 'manage') {
    return (
      <>
        <ManageView members={members} orgName={orgName} onUpdate={handleUpdate} onUpdateWithUndo={handleUpdateWithUndo}
          onDelete={handleDelete} onAdd={handleAdd}
          onDone={() => { if (members.length > 0) setView('dashboard') }}
          orgIcpSignals={orgIcpSignals} onOrgIcpUpload={handleOrgIcpUpload} onOrgIcpClear={handleOrgIcpClear}
          goals={goals} onMemberGoalChange={handleMemberGoalChange} onBulkGoals={handleBulkGoals} />
        {undoToastEl}
      </>
    )
  }

  const activeMember = members.find(m => m.id === activeTab) ?? null

  const navClick = (tab: string) => { setActiveTab(tab); setSidebarOpen(false) }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#FEFDFB] overflow-hidden">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[#E8ECF0] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="p-1 -ml-1"><Menu className="w-5 h-5 text-[#4A4A4A]" /></button>
          <p className="text-sm font-semibold text-[#2D2D2D] truncate">{orgName}</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'leaderboard' && members.length > 0 && (
            <button onClick={handleExportReport} disabled={exporting}
              className="p-1.5 bg-white border border-[#E8ECF0] rounded-lg text-[#4A4A4A] disabled:opacity-50">
              <FileText className="w-4 h-4" />
            </button>
          )}
          {activeTab === 'leaderboard' && allMonthsAcross.length > 0 && (
            <div className="relative">
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                className="bg-white border border-[#E8ECF0] text-[#2D2D2D] text-xs rounded-lg pl-2 pr-6 py-1.5 outline-none cursor-pointer appearance-none">
                {<option value="all">All Time</option>}{allMonthsAcross.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <ChevronDown className="w-3 h-3 text-[#D4D4D4] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      {/* Sidebar overlay backdrop (mobile) */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E8ECF0] flex flex-col flex-shrink-0 transition-transform duration-200 md:static md:w-44 md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-4 py-4 border-b border-[#EEF1F5] flex items-center justify-between">
          <div>
            <NotusLogo />
            <p className="text-xs font-semibold text-[#2D2D2D] mt-2 truncate">{orgName}</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1"><X className="w-4 h-4 text-[#6B6B6B]" /></button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <SectionLabel>Navigation</SectionLabel>
          <NavItem label="Team" active={activeTab === 'leaderboard'} onClick={() => navClick('leaderboard')} icon={<Users className="w-4 h-4" />} />
          <NavItem label="ICP Pipeline" active={activeTab === 'icp'} onClick={() => navClick('icp')} icon={<Zap className="w-4 h-4" />} />
          {members.length > 0 && (
            <>
              <SectionLabel>Members</SectionLabel>
              {members.map(m => (
                <NavItem key={m.id} label={m.name.split(' ')[0]} active={activeTab === m.id}
                  onClick={() => navClick(m.id)}
                  icon={
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                      style={{ backgroundColor: activeTab === m.id ? 'rgba(255,255,255,0.3)' : '#E8ECF0', color: activeTab === m.id ? 'white' : BRAND }}>
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                  }
                />
              ))}
            </>
          )}
        </nav>
        <div className="px-3 py-3 border-t border-[#EEF1F5]">
          <SectionLabel>Settings</SectionLabel>
          <NavItem label="Manage" active={false} onClick={() => { setView('manage'); setSidebarOpen(false) }} icon={<UserPlus className="w-4 h-4" />} />
        </div>
        <div className="px-4 py-3 border-t border-[#EEF1F5]"><p className="text-[10px] text-[#D4D4D4]">by notus</p></div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-4 md:px-6 md:py-6">
          {activeTab === 'leaderboard' ? (
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <div><h1 className="text-xl md:text-2xl font-semibold text-[#2D2D2D]">Team</h1><p className="text-base text-[#6B6B6B] mt-0.5">LinkedIn performance overview</p></div>
              <div className="flex items-center gap-2">
                {members.length > 0 && (
                  <button onClick={handleExportReport} disabled={exporting}
                    className="flex items-center gap-1.5 bg-white border border-[#E8ECF0] text-[#4A4A4A] text-sm rounded-lg px-3 py-2 hover:bg-[#FAF8F3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    <FileText className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">{exporting ? 'Generating…' : 'Export Report'}</span>
                  </button>
                )}
                {allMonthsAcross.length > 0 && (
                  <div className="relative hidden md:block">
                    <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                      className="bg-white border border-[#E8ECF0] text-[#2D2D2D] text-sm rounded-lg pl-3 pr-8 py-2 outline-none cursor-pointer appearance-none">
                      {<option value="all">All Time</option>}{allMonthsAcross.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                    </select>
                    <ChevronDown className="w-3 h-3 text-[#D4D4D4] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'icp' ? (
            <div className="mb-4 md:mb-6">
              <h1 className="text-xl md:text-2xl font-semibold text-[#2D2D2D]">ICP Pipeline</h1>
              <p className="text-base text-[#6B6B6B] mt-0.5">Signal tracking across all sources</p>
            </div>
          ) : activeMember ? (
            <div className="mb-4 md:mb-6">
              <h1 className="text-xl md:text-2xl font-semibold text-[#2D2D2D]">{activeMember.name}</h1>
              <p className="text-base text-[#6B6B6B] mt-0.5">{activeMember.role || 'LinkedIn Performance'}</p>
            </div>
          ) : null}

          {activeTab === 'leaderboard'
            ? <LeaderboardView members={members} selectedMonth={selectedMonth} orgIcpSignals={orgIcpSignals} />
            : activeTab === 'icp'
            ? <ICPPipelineView members={members} orgIcpSignals={orgIcpSignals} />
            : activeMember
            ? <MemberView member={activeMember} goals={goals[activeMember.id] ?? DEFAULT_GOALS}
                onGoalsChange={g => {
                  const prevGoals = goals
                  const newGoals = { ...goals, [activeMember.id]: g }
                  setGoals(newGoals)
                  authFetch(`/api/org/${slug}/goals`, {
                    method: 'PUT',
                    body: JSON.stringify(newGoals),
                  }).then(r => { if (!r.ok) throw new Error('Save failed') })
                    .catch(() => { setGoals(prevGoals); setSaveError('Failed to save goals') })
                }} />
            : null}
        </div>
      </main>

      {undoToastEl || (saveError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50">
          <span>{saveError}</span>
          <button onClick={() => setSaveError('')} className="text-white/70 hover:text-white font-bold">✕</button>
        </div>
      ))}
    </div>
  )
}
