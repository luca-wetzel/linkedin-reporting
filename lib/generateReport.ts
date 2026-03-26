import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Post {
  date: string; url?: string; impressions: number; clicks: number
  likes: number; comments: number; shares: number; follows: number
  engagements: number; engagementRate: number
}

interface ICPSignal {
  date: string; name?: string; company?: string; title?: string
  action: string; source?: string; isIcp?: boolean
}

interface FollowerEntry { date: string; newFollowers: number }

interface Member {
  id: string; name: string; role: string; posts: Post[]
  icpSignals: ICPSignal[]; followerHistory: FollowerEntry[]; addedAt: number
}

interface MemberGoals {
  monthlyPosts: number; monthlyImpressions: number
  monthlyFollowers: number; monthlyIcpSignals: number
}

export interface ReportData {
  orgName: string
  selectedMonth: string
  members: Member[]
  orgIcpSignals: ICPSignal[]
  goals: Record<string, MemberGoals>
}

// ─── Brand ──────────────────────────────────────────────────────────────────

const BRAND: [number, number, number] = [114, 47, 55]
const DARK: [number, number, number] = [68, 64, 60]
const MID: [number, number, number] = [107, 107, 107]
const GRAY: [number, number, number] = [150, 150, 150]
const RULE: [number, number, number] = [232, 236, 240]
const BG: [number, number, number] = [250, 248, 243]
const WHITE: [number, number, number] = [255, 255, 255]

const BENCHMARKS = {
  top10PerPost: 2500, top25PerPost: 800, medianPerPost: 300,
  top25EngRate: 3.5, top25MonthlyFollowers: 150,
}

// SVGs (embedded as strings, rendered to PNG via canvas at runtime)
const LOGO_SVG = `<svg width="413" height="109" viewBox="0 0 413 109" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M211.623 0C211.623 12.7593 204.332 25.5186 185.11 25.5186V30.9869H198.366V89.8122C198.366 103.731 204.332 108.371 221.897 108.371C227.696 108.371 231.673 107.874 236.479 106.383V100.914C230.679 102.571 227.696 102.903 225.211 102.903C219.577 102.903 217.091 99.9202 217.091 93.292V30.9869H249.871V80.0356C249.871 99.0917 258.488 108.371 276.55 108.371C292.126 108.371 301.074 101.246 310.022 92.4635L312.508 106.714H339.186V101.246H328.416V25.5186H298.92V30.9869H309.691V80.0356C309.691 84.841 308.697 86.6638 305.051 90.475C297.097 98.926 289.641 102.903 282.515 102.903C273.401 102.903 268.596 96.4404 268.596 82.5212V25.5186H217.091V0H211.623ZM89.3188 52.2086V101.259H100.09V106.728H59.822V101.259H70.5933V49.5572C70.5933 36.6317 66.782 29.3404 56.5078 29.3404C48.5536 29.3404 41.2623 33.8146 33.971 41.7688C30.8224 45.2487 29.331 47.9001 29.331 52.2086L29.4967 101.259H40.268V106.728H0V101.259H10.7713V30.9975H0V25.529H26.6796L29.1653 39.6145C37.4509 31.9918 46.5651 23.8719 64.7934 23.8719C78.0504 23.8719 89.3188 28.1804 89.3188 52.2086ZM102.077 66.1284C102.077 39.4488 115.169 23.8719 143.671 23.8719C172.008 23.8719 185.099 39.4488 185.099 66.1284C185.099 92.8081 172.008 108.385 143.671 108.385C115.169 108.385 102.077 92.8081 102.077 66.1284ZM166.374 66.1284C166.374 42.7631 157.757 29.0089 143.671 29.0089C129.42 29.0089 120.803 42.7631 120.803 66.1284C120.803 89.4938 129.42 103.082 143.671 103.082C157.757 103.082 166.374 89.4938 166.374 66.1284ZM359.622 41.6031C359.622 34.6432 366.251 29.3404 377.354 29.3404C385.805 29.3404 395.251 32.3232 402.045 45.7459H407.513V25.529H402.045L399.062 30.9975C393.096 25.8604 385.308 23.8719 377.022 23.8719C360.617 23.8719 346.863 31.9918 346.863 48.2315C346.863 65.63 362.255 69.8349 375.939 73.5728C386.887 76.5637 396.742 79.2557 396.742 88.1682C396.742 96.1223 389.119 102.917 377.519 102.917C368.902 102.917 359.954 99.1051 351.668 83.5282H346.2V106.728H351.668L355.148 99.1051C361.777 105.568 369.068 108.385 379.342 108.385C398.399 108.385 412.816 98.7737 412.816 82.2025C412.909 64.2488 396.135 59.8202 381.402 55.9303C369.889 52.8908 359.622 50.1802 359.622 41.6031Z" fill="FILLCOLOR"/></svg>`

const ICON_SVG = `<svg width="79" height="79" viewBox="0 0 79 79" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="78.4551" height="78.4551" rx="6.07214" fill="#6D2931"/><path fill-rule="evenodd" clip-rule="evenodd" d="M49.8051 35.7031V48.9155H52.7065V50.3885H41.8598V48.9155H44.7612V34.9889C44.7612 31.5073 43.7346 29.5433 40.9671 29.5433C38.8246 29.5433 36.8605 30.7485 34.8966 32.891C34.0485 33.8284 33.6467 34.5426 33.6467 35.7031L33.6914 48.9155H36.5927V50.3885H25.7461V48.9155H28.6475V29.9897H25.7461V28.5167H32.9325L33.6021 32.3108C35.8339 30.2575 38.2889 28.0703 43.1989 28.0703C46.7698 28.0703 49.8051 29.2309 49.8051 35.7031Z" fill="white"/></svg>`

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toString()
}

function fmtPct(n: number, d = 1): string { return n.toFixed(d) + '%' }

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
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m) - 1] + ' ' + y
}

function postsForMonth(posts: Post[], mk: string): Post[] {
  return posts.filter(p => { const d = parseFlexDate(p.date); return d ? monthKey(d) === mk : false })
}

function followerGrowthForMonth(posts: Post[], fh: FollowerEntry[], mk: string): number {
  if (fh.length > 0) return fh.filter(f => { const d = parseFlexDate(f.date); return d ? monthKey(d) === mk : false }).reduce((s, f) => s + f.newFollowers, 0)
  return postsForMonth(posts, mk).reduce((s, p) => s + p.follows, 0)
}

function icpForMonth(signals: ICPSignal[], mk: string): ICPSignal[] {
  return signals.filter(s => { const d = parseFlexDate(s.date); return d ? monthKey(d) === mk : false })
}

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

function tier(avg: number): string {
  if (avg >= BENCHMARKS.top10PerPost) return 'Top 10%'
  if (avg >= BENCHMARKS.top25PerPost) return 'Top 25%'
  if (avg >= BENCHMARKS.medianPerPost) return 'Top 50%'
  return 'Below 50%'
}

// ─── SVG to image ───────────────────────────────────────────────────────────

function svgToImage(svg: string, w: number, h: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w * 3; c.height = h * 3
      const ctx = c.getContext('2d')!
      ctx.scale(3, 3)
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.src = url
  })
}

// ─── Data computation ───────────────────────────────────────────────────────

function compute(data: ReportData) {
  const { members, orgIcpSignals, selectedMonth } = data
  const all = selectedMonth === 'all'
  const orgIcpF = all ? orgIcpSignals : icpForMonth(orgIcpSignals, selectedMonth)

  const rows = members.map(m => {
    const mp = all ? m.posts : postsForMonth(m.posts, selectedMonth)
    const mf = all ? m.followerHistory.reduce((s, f) => s + f.newFollowers, 0) : followerGrowthForMonth(m.posts, m.followerHistory, selectedMonth)
    const mIcp = all ? m.icpSignals : icpForMonth(m.icpSignals, selectedMonth)
    const aOrg = orgIcpF.filter(s => attributeOrgSignal(s, [m]) === m.name)
    const imp = mp.reduce((s, p) => s + p.impressions, 0)
    const avg = mp.length > 0 ? imp / mp.length : 0
    const eng = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
    return { m, posts: mp.length, imp, avg, eng, fol: mf, icp: mIcp.length + aOrg.length, tier: tier(avg) }
  }).sort((a, b) => b.imp - a.imp)

  const totImp = rows.reduce((s, r) => s + r.imp, 0)
  const totPosts = rows.reduce((s, r) => s + r.posts, 0)
  const totFol = rows.reduce((s, r) => s + r.fol, 0)
  const unattr = orgIcpF.filter(s => !attributeOrgSignal(s, members)).length
  const totIcp = rows.reduce((s, r) => s + r.icp, 0) + unattr

  // Trend (reversed: latest first)
  const byMonth: Record<string, number> = {}
  members.forEach(m => m.posts.forEach(p => { const d = parseFlexDate(p.date); if (d) { const mk = monthKey(d); byMonth[mk] = (byMonth[mk] || 0) + p.impressions } }))
  const trend = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v >= 500).map(([date, imp]) => ({ date, imp }))
  const trendReversed = [...trend].reverse()

  // ICP
  const compMap: Record<string, number> = {}
  const allSigs = [...orgIcpSignals, ...members.flatMap(m => m.icpSignals)]
  allSigs.forEach(s => { if (s.company) compMap[s.company] = (compMap[s.company] || 0) + 1 })
  const topComp = Object.entries(compMap).sort((a, b) => b[1] - a[1])

  const icpRows = members.map(m => {
    const own = m.icpSignals.length
    const att = orgIcpSignals.filter(s => attributeOrgSignal(s, [m]) === m.name).length
    const comps = new Set([...m.icpSignals.map(s => s.company).filter(Boolean), ...orgIcpSignals.filter(s => attributeOrgSignal(s, [m]) === m.name).map(s => s.company).filter(Boolean)])
    return { name: m.name, role: m.role, total: own + att, comps: comps.size }
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)

  const period = all ? 'All Time' : monthLabel(selectedMonth)
  return { rows, totImp, totPosts, totFol, totIcp, unattr, trend, trendReversed, topComp, icpRows, period }
}

// ─── PDF constants ──────────────────────────────────────────────────────────

const PW = 297
const PH = 210

// ─── Drawing primitives ─────────────────────────────────────────────────────

function kpiBlock(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, sub: string) {
  // Card with subtle border
  doc.setFillColor(...BG)
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, w, h, 2, 2, 'FD')

  // Label
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text(label.toUpperCase(), x + 5, y + 8)

  // Value
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...DARK)
  doc.text(value, x + 5, y + 20)

  // Sub
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(sub, x + 5, y + 27)
}

function sectionLabel(doc: jsPDF, x: number, y: number, text: string) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...BRAND)
  doc.text(text.toUpperCase(), x, y)
}

// ─── Page 1: Performance Overview ───────────────────────────────────────────

async function buildPage1(
  doc: jsPDF, orgName: string, period: string,
  logoWhite: string, iconImg: string,
  totImp: number, totPosts: number, totFol: number, totIcp: number,
  unattr: number,
  rows: ReturnType<typeof compute>['rows'],
  trendReversed: { date: string; imp: number }[],
  hasIcp: boolean,
) {
  // ── Top banner (brand color, 48mm tall) ──
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, 48, 'F')

  // Logo (white) — top left
  doc.addImage(logoWhite, 'PNG', 14, 10, 52, 14)

  // Org name — large, right-aligned
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...WHITE)
  doc.text(orgName, PW - 14, 22, { align: 'right' })

  // Subtitle line
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(255, 200, 200)
  doc.text(`LinkedIn Performance Report  ·  ${period}`, PW - 14, 32, { align: 'right' })

  // Date
  doc.setFontSize(7.5)
  doc.setTextColor(255, 180, 180)
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), PW - 14, 40, { align: 'right' })

  // ── KPI row ──
  const kpiY = 54
  const kpiH = 30
  const gap = 5
  const kpiW = (PW - 28 - gap * 3) / 4
  const avgPost = totPosts > 0 ? fmtN(totImp / totPosts) : '—'
  kpiBlock(doc, 14, kpiY, kpiW, kpiH, 'Impressions', fmtN(totImp), `${rows.length} members · ${avgPost}/post`)
  kpiBlock(doc, 14 + kpiW + gap, kpiY, kpiW, kpiH, 'Posts', totPosts.toString(), `${period}`)
  kpiBlock(doc, 14 + (kpiW + gap) * 2, kpiY, kpiW, kpiH, 'Follower Growth', `+${fmtN(totFol)}`, `${period}`)
  kpiBlock(doc, 14 + (kpiW + gap) * 3, kpiY, kpiW, kpiH, 'ICP Signals', fmtN(totIcp), unattr > 0 ? `incl. ${unattr} unattributed` : 'All sources')

  // ── Divider ──
  const divY1 = kpiY + kpiH + 5
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.3)
  doc.line(14, divY1, PW - 14, divY1)

  // ── Content Leaderboard ──
  const tableY = divY1 + 5
  sectionLabel(doc, 14, tableY, 'Content Leaderboard')

  const head = ['#', 'Name', 'Role', 'Posts', 'Impressions', 'Avg/Post', 'Followers', 'Eng. Rate']
  if (hasIcp) head.push('ICP')
  head.push('Tier')

  const body = rows.map((r, i) => {
    const row = [
      `${i + 1}`,
      r.m.name,
      r.m.role || '–',
      r.posts.toString(),
      fmtN(r.imp),
      r.posts > 0 ? fmtN(r.avg) : '–',
      r.fol > 0 ? `+${fmtN(r.fol)}` : '–',
      r.posts > 0 ? fmtPct(r.eng) : '–',
    ]
    if (hasIcp) row.push(r.icp > 0 ? r.icp.toString() : '–')
    row.push(r.posts > 0 ? r.tier : '–')
    return row
  })

  autoTable(doc, {
    startY: tableY + 2,
    head: [head],
    body,
    headStyles: {
      fillColor: BRAND, textColor: WHITE, fontSize: 8, fontStyle: 'bold',
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 9, textColor: MID,
      cellPadding: { top: 4.5, bottom: 4.5, left: 4, right: 4 },
    },
    alternateRowStyles: { fillColor: BG },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center', textColor: GRAY },
      1: { cellWidth: 36, fontStyle: 'bold', textColor: DARK },
      2: { cellWidth: 22, textColor: GRAY },
    },
    styles: { lineWidth: 0 },
    margin: { left: 14, right: 14 },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = ((doc as any).lastAutoTable?.finalY ?? 140) + 3

  // Benchmark legend
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  doc.text(`notus benchmark (50K posts)   Top 10% = ${fmtN(BENCHMARKS.top10PerPost)}/post  ·  Top 25% = ${fmtN(BENCHMARKS.top25PerPost)}/post  ·  Top 50% = ${fmtN(BENCHMARKS.medianPerPost)}/post`, 14, y)
  y += 7

  // ── Divider + Trend (compact, latest first) ──
  if (trendReversed.length > 1) {
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.3)
    doc.line(14, y, PW - 14, y)
    y += 5

    sectionLabel(doc, 14, y, 'Impressions by Month')
    y += 5

    const maxVal = Math.max(...trendReversed.map(d => d.imp))
    const labelX = 14
    const barStartX = 52 // more room for month labels
    const valueX = PW - 14
    const barMax = valueX - barStartX - 16
    const barH = 8
    const rowH = barH + 4

    // Only show as many as fit
    const available = PH - y - 12
    const maxRows = Math.floor(available / rowH)
    const shown = trendReversed.slice(0, Math.min(trendReversed.length, maxRows))

    for (const pt of shown) {
      const bw = maxVal > 0 ? (pt.imp / maxVal) * barMax : 0
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...MID)
      doc.text(monthLabel(pt.date), labelX, y + 5.5)
      if (bw > 0.5) {
        doc.setFillColor(...BRAND)
        doc.roundedRect(barStartX, y, bw, barH, 2, 2, 'F')
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...DARK)
      doc.text(fmtN(pt.imp), valueX, y + 5.5, { align: 'right' })
      y += rowH
    }
  }

  // ── Footer ──
  drawPageFooter(doc, iconImg, 1)
}

// ─── Page 2: ICP Pipeline ───────────────────────────────────────────────────

function buildPage2(
  doc: jsPDF, orgName: string, iconImg: string,
  totIcp: number, topComp: [string, number][], icpRows: { name: string; role: string; total: number; comps: number }[],
  unattr: number, totalPages: number,
) {
  // Header bar
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, 14, 'F')
  doc.addImage(iconImg, 'PNG', 10, 3, 8, 8)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...WHITE)
  doc.text('notus', 20, 9.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(orgName, PW - 14, 9.5, { align: 'right' })

  let y = 24

  // Section title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...DARK)
  doc.text('ICP Pipeline', 14, y)
  y += 8

  // KPI row
  const kpiW = (PW - 28 - 10) / 3
  kpiBlock(doc, 14, y, kpiW, 28, 'Total Signals', fmtN(totIcp), unattr > 0 ? `incl. ${unattr} unattributed` : 'All sources')
  kpiBlock(doc, 14 + kpiW + 5, y, kpiW, 28, 'Companies Reached', topComp.length.toString(), topComp[0] ? `Top: ${topComp[0][0]}` : '–')
  kpiBlock(doc, 14 + (kpiW + 5) * 2, y, kpiW, 28, 'Top Company', topComp[0]?.[0] ?? '–', topComp[0] ? `${topComp[0][1]} signals` : '–')
  y += 36

  // Divider
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.3)
  doc.line(14, y - 2, PW - 14, y - 2)

  // Two tables side by side
  const halfW = (PW - 28 - 8) / 2

  // Left: Top Companies
  sectionLabel(doc, 14, y, 'Top Companies')
  const compTableY = y + 3

  autoTable(doc, {
    startY: compTableY,
    head: [['Company', 'Signals']],
    body: topComp.slice(0, 8).map(([c, n]) => [c, n.toString()]),
    headStyles: { fillColor: BRAND, textColor: WHITE, fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
    bodyStyles: { fontSize: 8.5, textColor: MID, cellPadding: 3 },
    alternateRowStyles: { fillColor: BG },
    styles: { lineWidth: 0 },
    margin: { left: 14, right: PW - 14 - halfW },
    tableWidth: halfW,
  })

  // Right: ICP Leaderboard
  sectionLabel(doc, 14 + halfW + 8, y, 'ICP by Member')

  autoTable(doc, {
    startY: compTableY,
    head: [['Member', 'Signals', 'Companies']],
    body: icpRows.map(r => [r.name, r.total.toString(), r.comps.toString()]),
    headStyles: { fillColor: BRAND, textColor: WHITE, fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
    bodyStyles: { fontSize: 8.5, textColor: MID, cellPadding: 3 },
    alternateRowStyles: { fillColor: BG },
    styles: { lineWidth: 0 },
    margin: { left: 14 + halfW + 8, right: 14 },
    tableWidth: halfW,
  })

  drawPageFooter(doc, iconImg, totalPages)
}

// ─── Shared header/footer ───────────────────────────────────────────────────

function drawPageHeader(doc: jsPDF, orgName: string, iconImg: string) {
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, 14, 'F')
  doc.addImage(iconImg, 'PNG', 10, 3, 8, 8)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...WHITE)
  doc.text('notus', 20, 9.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(orgName, PW - 14, 9.5, { align: 'right' })
}

function drawPageFooter(doc: jsPDF, iconImg: string, pageNum: number) {
  doc.setDrawColor(...RULE)
  doc.line(14, PH - 10, PW - 14, PH - 10)
  doc.addImage(iconImg, 'PNG', 14, PH - 8.5, 4.5, 4.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  doc.text('notus', 20, PH - 5.2)
  doc.text(pageNum.toString(), PW - 14, PH - 5.2, { align: 'right' })
}

// ─── Per-member page ────────────────────────────────────────────────────────

function buildMemberPage(
  doc: jsPDF, orgName: string, iconImg: string, pageNum: number,
  member: Member, period: string, selectedMonth: string,
  orgIcpSignals: ICPSignal[], goals: MemberGoals | undefined,
) {
  drawPageHeader(doc, orgName, iconImg)

  const isAll = selectedMonth === 'all'

  // Get all months for this member
  const monthSet = new Set<string>()
  member.posts.forEach(p => { const d = parseFlexDate(p.date); if (d) monthSet.add(monthKey(d)) })
  const months = Array.from(monthSet).sort().reverse()
  const latestMonth = months[0] ?? monthKey(new Date())

  // Compute for the selected period
  const mp = isAll ? member.posts : postsForMonth(member.posts, selectedMonth)
  const mf = isAll
    ? member.followerHistory.reduce((s, f) => s + f.newFollowers, 0)
    : followerGrowthForMonth(member.posts, member.followerHistory, selectedMonth)
  const mIcp = isAll ? member.icpSignals : icpForMonth(member.icpSignals, selectedMonth)
  const attOrg = (isAll ? orgIcpSignals : icpForMonth(orgIcpSignals, selectedMonth))
    .filter(s => attributeOrgSignal(s, [member]) === member.name)
  const icpTotal = mIcp.length + attOrg.length
  const totalImp = mp.reduce((s, p) => s + p.impressions, 0)
  const avgPerPost = mp.length > 0 ? totalImp / mp.length : 0
  const avgEng = mp.length > 0 ? mp.reduce((s, p) => s + p.engagementRate, 0) / mp.length : 0
  const memberTier = tier(avgPerPost)

  let y = 22

  // ── Member name + tier ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...DARK)
  doc.text(member.name, 14, y)

  // Tier badge
  if (mp.length > 0) {
    const nameW = doc.getTextWidth(member.name)
    const tierText = memberTier
    doc.setFontSize(7)
    const tierW = doc.getTextWidth(tierText) + 6
    const tierX = 14 + nameW + 6
    doc.setFillColor(...BRAND)
    doc.roundedRect(tierX, y - 5, tierW, 7, 2, 2, 'F')
    doc.setTextColor(...WHITE)
    doc.text(tierText, tierX + 3, y - 0.8)
  }

  // Role + period
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(`${member.role || 'Team Member'}  ·  ${period}`, 14, y + 6)
  y += 14

  // ── KPI row ──
  const kpiH = 28
  const gap = 5
  const hasIcp = icpTotal > 0 || member.icpSignals.length > 0
  const numKpis = hasIcp ? 4 : 3
  const kpiW = (PW - 28 - gap * (numKpis - 1)) / numKpis

  kpiBlock(doc, 14, y, kpiW, kpiH, 'Impressions', fmtN(totalImp), `${mp.length} posts · ${mp.length > 0 ? fmtN(avgPerPost) : '–'}/post`)
  kpiBlock(doc, 14 + (kpiW + gap), y, kpiW, kpiH, 'Follower Growth', `+${fmtN(mf)}`, period)
  kpiBlock(doc, 14 + (kpiW + gap) * 2, y, kpiW, kpiH, 'Engagement Rate', mp.length > 0 ? fmtPct(avgEng) : '–', `Benchmark: ${BENCHMARKS.top25EngRate}%`)
  if (hasIcp) {
    kpiBlock(doc, 14 + (kpiW + gap) * 3, y, kpiW, kpiH, 'ICP Signals', icpTotal.toString(), mIcp.filter(s => s.isIcp).length > 0 ? `${mIcp.filter(s => s.isIcp).length} confirmed ICP` : 'All signals')
  }
  y += kpiH + 4

  // Divider
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.3)
  doc.line(14, y, PW - 14, y)
  y += 5

  // ── Monthly breakdown (left side) + Goals (right side) ──
  const colW = (PW - 28 - 8) / 2

  // Left: Monthly performance table
  sectionLabel(doc, 14, y, 'Monthly Performance')
  const monthTableY = y + 3

  // Compute per-month data (latest first), including ICP with org attribution
  const monthData = months.slice(0, 8).map(mk => {
    const mPosts = postsForMonth(member.posts, mk)
    const mImpTotal = mPosts.reduce((s, p) => s + p.impressions, 0)
    const mFol = followerGrowthForMonth(member.posts, member.followerHistory, mk)
    const mAvg = mPosts.length > 0 ? mImpTotal / mPosts.length : 0
    const mIcpOwn = icpForMonth(member.icpSignals, mk).length
    const mIcpAttr = icpForMonth(orgIcpSignals, mk).filter(s => attributeOrgSignal(s, [member]) === member.name).length
    return { month: mk, posts: mPosts.length, imp: mImpTotal, fol: mFol, avg: mAvg, icp: mIcpOwn + mIcpAttr }
  })

  const showIcpCol = icpTotal > 0
  const monthHead = ['Month', 'Posts', 'Impressions', 'Avg/Post', 'Followers']
  if (showIcpCol) monthHead.push('ICP')

  if (monthData.length > 0) {
    autoTable(doc, {
      startY: monthTableY,
      head: [monthHead],
      body: monthData.map(d => {
        const row = [
          monthLabel(d.month),
          d.posts.toString(),
          fmtN(d.imp),
          d.posts > 0 ? fmtN(d.avg) : '–',
          d.fol > 0 ? `+${fmtN(d.fol)}` : '–',
        ]
        if (showIcpCol) row.push(d.icp > 0 ? d.icp.toString() : '–')
        return row
      }),
      headStyles: { fillColor: BRAND, textColor: WHITE, fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
      bodyStyles: { fontSize: 8.5, textColor: MID, cellPadding: 3 },
      alternateRowStyles: { fillColor: BG },
      styles: { lineWidth: 0 },
      margin: { left: 14, right: PW - 14 - colW },
      tableWidth: colW,
    })
  }

  // Right side: Goals + Insights
  const rightX = 14 + colW + 8

  // Goals
  if (goals) {
    sectionLabel(doc, rightX, y, 'Monthly Goals')
    let gy = y + 5

    const goalItems = [
      { label: 'Posts', current: postsForMonth(member.posts, latestMonth).length, goal: goals.monthlyPosts },
      { label: 'Impressions', current: postsForMonth(member.posts, latestMonth).reduce((s, p) => s + p.impressions, 0), goal: goals.monthlyImpressions },
      { label: 'Followers', current: followerGrowthForMonth(member.posts, member.followerHistory, latestMonth), goal: goals.monthlyFollowers },
      { label: 'ICP Signals', current: (() => {
        // Try latest month first (own + attributed org signals)
        const own = icpForMonth(member.icpSignals, latestMonth).length
        const attr = icpForMonth(orgIcpSignals, latestMonth).filter(s => attributeOrgSignal(s, [member]) === member.name).length
        const monthCount = own + attr
        // If month count is 0 but member has total ICP, show monthly average
        if (monthCount === 0 && icpTotal > 0 && months.length > 0) {
          return Math.round(icpTotal / Math.min(months.length, 3)) // avg over recent months
        }
        return monthCount
      })(), goal: goals.monthlyIcpSignals },
    ]

    for (const g of goalItems) {
      const pct = g.goal > 0 ? Math.min(100, (g.current / g.goal) * 100) : 0

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...MID)
      doc.text(g.label, rightX, gy)
      doc.text(`${fmtN(g.current)} / ${fmtN(g.goal)}`, rightX + colW - 2, gy, { align: 'right' })
      gy += 3

      // Progress bar background
      doc.setFillColor(...RULE)
      doc.roundedRect(rightX, gy, colW - 2, 2.5, 1, 1, 'F')
      // Progress bar fill
      if (pct > 0) {
        const barColor: [number, number, number] = pct >= 100 ? [22, 163, 74] : pct >= 60 ? [22, 163, 74] : [217, 119, 6]
        doc.setFillColor(...barColor)
        doc.roundedRect(rightX, gy, Math.max(1, (pct / 100) * (colW - 2)), 2.5, 1, 1, 'F')
      }
      gy += 6
    }

    gy += 3
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(`Goals for ${monthLabel(latestMonth)}`, rightX, gy)
    gy += 8

    // ICP summary (if applicable)
    if (icpTotal > 0) {
      const allMemberIcp = [...mIcp, ...attOrg]
      const companies = new Set(allMemberIcp.map(s => s.company).filter(Boolean))
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...MID)
      doc.text(`${icpTotal} ICP signals · ${companies.size} companies reached`, rightX, gy)
    }
  }

  drawPageFooter(doc, iconImg, pageNum)
}

// ─── Main ───────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: MemberGoals = {
  monthlyPosts: 8, monthlyImpressions: 10000,
  monthlyFollowers: 100, monthlyIcpSignals: 20,
}

export async function generateReport(data: ReportData): Promise<void> {
  const c = compute(data)
  const hasIcp = c.totIcp > 0

  // Render logos
  const logoWhiteSvg = LOGO_SVG.replace('FILLCOLOR', '#FFFFFF')
  const logoWhite = await svgToImage(logoWhiteSvg, 413, 109)
  const iconImg = await svgToImage(ICON_SVG, 79, 79)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  let pageNum = 1

  // Page 1: Performance Overview
  await buildPage1(doc, data.orgName, c.period, logoWhite, iconImg,
    c.totImp, c.totPosts, c.totFol, c.totIcp, c.unattr,
    c.rows, c.trendReversed, hasIcp)

  // Page 2: ICP Pipeline (only if data)
  if (hasIcp) {
    pageNum++
    doc.addPage()
    buildPage2(doc, data.orgName, iconImg, c.totIcp, c.topComp, c.icpRows, c.unattr, pageNum)
  }

  // Per-member pages (sorted by impressions, matching leaderboard order)
  for (const row of c.rows) {
    pageNum++
    doc.addPage()
    buildMemberPage(doc, data.orgName, iconImg, pageNum,
      row.m, c.period, data.selectedMonth,
      data.orgIcpSignals, data.goals[row.m.id] ?? DEFAULT_GOALS)
  }

  const slug = data.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const ps = data.selectedMonth === 'all' ? 'all-time' : data.selectedMonth
  doc.save(`${slug}-linkedin-report-${ps}.pdf`)
}
