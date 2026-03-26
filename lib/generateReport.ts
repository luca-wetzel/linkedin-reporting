import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Types (duplicated from page.tsx — pure data, no React) ─────────────────

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
  selectedMonth: string // 'all' or 'YYYY-MM'
  members: Member[]
  orgIcpSignals: ICPSignal[]
  goals: Record<string, MemberGoals>
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BRAND: [number, number, number] = [114, 47, 55]
const BRAND_LIGHT: [number, number, number] = [244, 236, 237]
const DARK: [number, number, number] = [45, 45, 45]
const GRAY: [number, number, number] = [107, 107, 107]
const LIGHT_GRAY: [number, number, number] = [212, 212, 212]
const BG: [number, number, number] = [250, 248, 243]
const WHITE: [number, number, number] = [255, 255, 255]

const BENCHMARKS = {
  top10PerPost: 2500,
  top25PerPost: 800,
  medianPerPost: 300,
  top25EngRate: 3.5,
  top25MonthlyFollowers: 150,
}

// ─── Helpers (duplicated from page.tsx) ─────────────────────────────────────

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
    return followerHistory.filter(f => { const d = parseFlexDate(f.date); return d ? monthKey(d) === mk : false }).reduce((s, f) => s + f.newFollowers, 0)
  }
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

function tier(avgPerPost: number): { label: string } {
  if (avgPerPost >= BENCHMARKS.top10PerPost) return { label: 'Top 10%' }
  if (avgPerPost >= BENCHMARKS.top25PerPost) return { label: 'Top 25%' }
  if (avgPerPost >= BENCHMARKS.medianPerPost) return { label: 'Top 50%' }
  return { label: 'Below 50%' }
}

// ─── Data computation ───────────────────────────────────────────────────────

function computeReportData(data: ReportData) {
  const { members, orgIcpSignals, selectedMonth } = data
  const isAllTime = selectedMonth === 'all'

  const orgIcpFiltered = isAllTime ? orgIcpSignals : icpForMonth(orgIcpSignals, selectedMonth)

  const rows = members.map(m => {
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

  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0)
  const totalPosts = rows.reduce((s, r) => s + r.postCount, 0)
  const totalFollowers = rows.reduce((s, r) => s + r.followers, 0)
  const unattributedIcp = orgIcpFiltered.filter(s => !attributeOrgSignal(s, members)).length
  const totalIcp = rows.reduce((s, r) => s + r.icpTotal, 0) + unattributedIcp
  const teamAvgPerPost = totalPosts > 0 ? totalImpressions / totalPosts : 0

  // Impressions trend
  const byMonth: Record<string, number> = {}
  members.forEach(m => m.posts.forEach(p => {
    const d = parseFlexDate(p.date); if (!d) return
    const mk = monthKey(d)
    byMonth[mk] = (byMonth[mk] || 0) + p.impressions
  }))
  const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
  const startIdx = sorted.findIndex(([, v]) => v >= 500)
  const impressionsTrend = sorted.slice(startIdx >= 0 ? startIdx : 0).filter(([, v]) => v > 0).map(([date, impressions]) => ({ date, impressions }))

  // ICP data
  const allIcpSignals = [
    ...orgIcpSignals.map(s => ({ ...s, via: attributeOrgSignal(s, members) })),
    ...members.flatMap(m => m.icpSignals.map(s => ({ ...s, via: m.name }))),
  ]
  const companyCounts: Record<string, number> = {}
  allIcpSignals.forEach(s => { if (s.company) companyCounts[s.company] = (companyCounts[s.company] || 0) + 1 })
  const topCompanies = Object.entries(companyCounts).sort((a, b) => b[1] - a[1])

  const icpRows = members.map(m => {
    const memberSignals = m.icpSignals.length
    const attributedOrg = orgIcpSignals.filter(s => attributeOrgSignal(s, [m]) === m.name).length
    const companies = new Set([
      ...m.icpSignals.map(s => s.company).filter(Boolean),
      ...orgIcpSignals.filter(s => attributeOrgSignal(s, [m]) === m.name).map(s => s.company).filter(Boolean),
    ])
    return { member: m, total: memberSignals + attributedOrg, companies: companies.size }
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total)

  const periodLabel = isAllTime ? 'All Time' : monthLabel(selectedMonth)

  return {
    rows, totalImpressions, totalPosts, totalFollowers, totalIcp, teamAvgPerPost,
    unattributedIcp, impressionsTrend, allIcpSignals, topCompanies, icpRows, periodLabel,
  }
}

// ─── PDF Drawing helpers ────────────────────────────────────────────────────

const PW = 297 // A4 landscape width mm
const PH = 210 // A4 landscape height mm

function drawHeader(doc: jsPDF, orgName: string) {
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, 14, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...WHITE)
  doc.text('notus', 12, 9.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(orgName, PW - 12, 9.5, { align: 'right' })
}

function drawFooter(doc: jsPDF, pageLabel: string) {
  const y = PH - 8
  doc.setDrawColor(...LIGHT_GRAY)
  doc.line(12, y - 4, PW - 12, y - 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...LIGHT_GRAY)
  doc.text('by notus', 12, y)
  doc.text(pageLabel, PW - 12, y, { align: 'right' })
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...DARK)
  doc.text(title, 12, y)
  return y + 8
}

function drawKpiBox(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, sub: string) {
  doc.setFillColor(...WHITE)
  doc.setDrawColor(232, 236, 240)
  doc.roundedRect(x, y, w, 32, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text(label.toUpperCase(), x + 6, y + 9)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...DARK)
  doc.text(value, x + 6, y + 22)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text(sub, x + 6, y + 29)
}

// ─── Page builders ──────────────────────────────────────────────────────────

function buildCoverPage(doc: jsPDF, orgName: string, periodLabel: string) {
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, PH, 'F')

  // notus wordmark
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(42)
  doc.setTextColor(...WHITE)
  doc.text('notus', PW / 2, 70, { align: 'center' })

  // Thin rule
  doc.setDrawColor(255, 255, 255, 80)
  doc.setLineWidth(0.3)
  doc.line(PW / 2 - 40, 80, PW / 2 + 40, 80)

  // Org name
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(orgName, PW / 2, 96, { align: 'center' })

  // Subtitle
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(255, 220, 220)
  doc.text('LinkedIn Performance Report', PW / 2, 108, { align: 'center' })

  // Period
  doc.setFontSize(11)
  doc.text(periodLabel, PW / 2, 118, { align: 'center' })

  // Date at bottom
  doc.setFontSize(8)
  doc.setTextColor(255, 200, 200)
  doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, PW / 2, PH - 16, { align: 'center' })
}

function buildExecutiveSummary(
  doc: jsPDF, orgName: string, periodLabel: string,
  totalImpressions: number, totalPosts: number, totalFollowers: number, totalIcp: number,
  teamAvgPerPost: number, rows: ReturnType<typeof computeReportData>['rows'],
  topCompanies: [string, number][], unattributedIcp: number,
) {
  drawHeader(doc, orgName)
  let y = drawSectionTitle(doc, `Executive Summary — ${periodLabel}`, 26)

  // KPI boxes
  const boxW = (PW - 24 - 18) / 4 // 4 boxes with 6mm gaps
  y += 2
  drawKpiBox(doc, 12, y, boxW, 'Team Impressions', fmtN(totalImpressions), `${rows.length} members`)
  drawKpiBox(doc, 12 + boxW + 6, y, boxW, 'Posts Published', totalPosts.toString(), `${fmtN(teamAvgPerPost)} avg/post`)
  drawKpiBox(doc, 12 + (boxW + 6) * 2, y, boxW, 'Follower Growth', `+${fmtN(totalFollowers)}`, periodLabel)
  drawKpiBox(doc, 12 + (boxW + 6) * 3, y, boxW, 'ICP Signals', fmtN(totalIcp), unattributedIcp > 0 ? `incl. ${unattributedIcp} unattributed` : 'All sources')

  y += 44

  // Insights
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...DARK)
  doc.text('Key Insights', 12, y)
  y += 8

  const insights: string[] = []
  if (rows.length > 0) {
    const top = rows[0]
    insights.push(`${top.member.name} leads the team with ${fmtN(top.impressions)} impressions (${top.tier.label} creator).`)
  }
  const teamTier = tier(teamAvgPerPost)
  if (totalPosts > 0) {
    insights.push(`Team averages ${fmtN(teamAvgPerPost)} impressions per post, placing in the ${teamTier.label} bracket (notus benchmark: 50K posts).`)
  }
  const followerLeader = [...rows].sort((a, b) => b.followers - a.followers)[0]
  if (followerLeader && followerLeader.followers > 0) {
    insights.push(`${followerLeader.member.name} leads in follower growth with +${fmtN(followerLeader.followers)} new followers.`)
  }
  if (topCompanies.length > 0) {
    insights.push(`${topCompanies[0][0]} is the most engaged ICP account with ${topCompanies[0][1]} signals.`)
  }
  if (rows.length > 1) {
    const engLeader = [...rows].filter(r => r.postCount > 0).sort((a, b) => b.avgEng - a.avgEng)[0]
    if (engLeader && engLeader.avgEng >= BENCHMARKS.top25EngRate) {
      insights.push(`${engLeader.member.name} has a ${fmtPct(engLeader.avgEng)} engagement rate — above the top 25% benchmark (${BENCHMARKS.top25EngRate}%).`)
    }
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  for (const ins of insights) {
    doc.setFillColor(...BRAND)
    doc.circle(16, y - 1.2, 1, 'F')
    doc.text(ins, 20, y, { maxWidth: PW - 40 })
    y += 8
  }

  drawFooter(doc, '')
}

function buildLeaderboard(
  doc: jsPDF, orgName: string, periodLabel: string,
  rows: ReturnType<typeof computeReportData>['rows'],
  hasIcp: boolean,
) {
  drawHeader(doc, orgName)
  drawSectionTitle(doc, `Content Leaderboard — ${periodLabel}`, 26)

  const head = ['#', 'Name', 'Role', 'Posts', 'Impressions', 'Avg/Post', 'Followers', 'Eng. Rate']
  if (hasIcp) head.push('ICP Signals')
  head.push('Tier')

  const body = rows.map((r, i) => {
    const row = [
      `${i + 1}`,
      r.member.name,
      r.member.role || '—',
      r.postCount.toString(),
      fmtN(r.impressions),
      r.postCount > 0 ? fmtN(r.avgPerPost) : '—',
      r.followers > 0 ? `+${fmtN(r.followers)}` : '—',
      r.postCount > 0 ? fmtPct(r.avgEng) : '—',
    ]
    if (hasIcp) row.push(r.icpTotal > 0 ? r.icpTotal.toString() : '—')
    row.push(r.postCount > 0 ? r.tier.label : '—')
    return row
  })

  autoTable(doc, {
    startY: 34,
    head: [head],
    body,
    headStyles: { fillColor: BRAND, textColor: WHITE, fontSize: 7.5, fontStyle: 'bold', cellPadding: 3 },
    bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 3 },
    alternateRowStyles: { fillColor: BG },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 38 },
      2: { cellWidth: 28 },
    },
    styles: { lineWidth: 0, overflow: 'ellipsize' },
    margin: { left: 12, right: 12 },
    didDrawPage: () => {
      drawHeader(doc, orgName)
      drawFooter(doc, '')
    },
  })

  // Benchmark legend
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY ?? 160
  const ly = finalY + 6
  doc.setFontSize(7)
  doc.setTextColor(...LIGHT_GRAY)
  doc.text(`notus benchmark (50K posts)  ·  Top 10% = ${fmtN(BENCHMARKS.top10PerPost)}/post  ·  Top 25% = ${fmtN(BENCHMARKS.top25PerPost)}/post  ·  Top 50% = ${fmtN(BENCHMARKS.medianPerPost)}/post`, 12, ly)

  drawFooter(doc, '')
}

function buildImpressionsTrend(
  doc: jsPDF, orgName: string,
  impressionsTrend: { date: string; impressions: number }[],
) {
  drawHeader(doc, orgName)
  let y = drawSectionTitle(doc, 'Impressions Trend', 26)
  y += 4

  if (impressionsTrend.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY)
    doc.text('No trend data available.', 12, y)
    drawFooter(doc, '')
    return
  }

  const maxVal = Math.max(...impressionsTrend.map(d => d.impressions))
  const barMaxWidth = PW - 90 // leave room for labels
  const barHeight = 7
  const gap = 3

  // Check if we need to split across multiple columns or keep it simple
  const rowsPerPage = Math.floor((PH - y - 20) / (barHeight + gap))

  for (let i = 0; i < impressionsTrend.length; i++) {
    if (i > 0 && i % rowsPerPage === 0) {
      // New page for overflow
      doc.addPage()
      drawHeader(doc, orgName)
      y = 26
    }

    const point = impressionsTrend[i]
    const barWidth = maxVal > 0 ? (point.impressions / maxVal) * barMaxWidth : 0

    // Month label
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text(monthLabel(point.date), 12, y + 5)

    // Bar
    doc.setFillColor(...BRAND)
    if (barWidth > 1) {
      doc.roundedRect(46, y, barWidth, barHeight, 1.5, 1.5, 'F')
    }

    // Value
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...DARK)
    doc.text(fmtN(point.impressions), 46 + barWidth + 4, y + 5)

    y += barHeight + gap
  }

  // Growth summary
  if (impressionsTrend.length >= 2) {
    y += 6
    const first = impressionsTrend[0]
    const last = impressionsTrend[impressionsTrend.length - 1]
    const growth = first.impressions > 0 ? ((last.impressions - first.impressions) / first.impressions) * 100 : 0
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    const direction = growth >= 0 ? '↑' : '↓'
    doc.text(`${direction} ${Math.abs(growth).toFixed(0)}% overall growth from ${monthLabel(first.date)} to ${monthLabel(last.date)}`, 12, y)
  }

  drawFooter(doc, '')
}

function buildIcpPipeline(
  doc: jsPDF, orgName: string,
  totalIcp: number, topCompanies: [string, number][],
  icpRows: { member: Member; total: number; companies: number }[],
  unattributedIcp: number,
) {
  drawHeader(doc, orgName)
  let y = drawSectionTitle(doc, 'ICP Pipeline — All Time', 26)

  // Stats row
  const boxW = (PW - 24 - 12) / 3
  drawKpiBox(doc, 12, y, boxW, 'Total Signals', fmtN(totalIcp), 'All sources')
  drawKpiBox(doc, 12 + boxW + 6, y, boxW, 'Companies Reached', topCompanies.length.toString(), topCompanies[0] ? `Top: ${topCompanies[0][0]}` : '—')
  drawKpiBox(doc, 12 + (boxW + 6) * 2, y, boxW, 'Top Company', topCompanies[0]?.[0] ?? '—', topCompanies[0] ? `${topCompanies[0][1]} signals` : '—')
  y += 42

  // Top companies table
  if (topCompanies.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...DARK)
    doc.text('Top Companies', 12, y)
    y += 2

    autoTable(doc, {
      startY: y,
      head: [['#', 'Company', 'Signals', '% of Total']],
      body: topCompanies.slice(0, 10).map(([company, ct], i) => [
        `${i + 1}`, company, ct.toString(), `${((ct / totalIcp) * 100).toFixed(1)}%`
      ]),
      headStyles: { fillColor: BRAND, textColor: WHITE, fontSize: 7.5, fontStyle: 'bold', cellPadding: 2.5 },
      bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: BG },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' } },
      styles: { lineWidth: 0 },
      margin: { left: 12, right: PW / 2 + 6 },
      tableWidth: PW / 2 - 18,
    })
  }

  // ICP leaderboard — right column or below
  if (icpRows.length > 0) {
    const icpStartY = y
    autoTable(doc, {
      startY: icpStartY,
      head: [['#', 'Member', 'ICP Signals', 'Companies']],
      body: icpRows.map((r, i) => [
        `${i + 1}`, r.member.name, r.total.toString(), r.companies.toString()
      ]),
      headStyles: { fillColor: BRAND, textColor: WHITE, fontSize: 7.5, fontStyle: 'bold', cellPadding: 2.5 },
      bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: BG },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' } },
      styles: { lineWidth: 0 },
      margin: { left: PW / 2 + 6, right: 12 },
      tableWidth: PW / 2 - 18,
    })
  }

  if (unattributedIcp > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...LIGHT_GRAY)
    doc.text(`+ ${unattributedIcp} unattributed signal${unattributedIcp > 1 ? 's' : ''} (org-level, not matched to a member)`, 12, PH - 18)
  }

  drawFooter(doc, '')
}

function buildBackCover(doc: jsPDF) {
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, PW, PH, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(32)
  doc.setTextColor(...WHITE)
  doc.text('notus', PW / 2, PH / 2 - 8, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(255, 220, 220)
  doc.text('Generated by notus', PW / 2, PH / 2 + 6, { align: 'center' })

  doc.setFontSize(8)
  doc.setTextColor(255, 200, 200)
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), PW / 2, PH / 2 + 14, { align: 'center' })
}

// ─── Main export ────────────────────────────────────────────────────────────

export async function generateReport(data: ReportData): Promise<void> {
  const computed = computeReportData(data)
  const { rows, totalImpressions, totalPosts, totalFollowers, totalIcp, teamAvgPerPost, unattributedIcp, impressionsTrend, topCompanies, icpRows, periodLabel } = computed
  const hasIcp = totalIcp > 0

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Page 1: Cover
  buildCoverPage(doc, data.orgName, periodLabel)

  // Page 2: Executive Summary
  doc.addPage()
  buildExecutiveSummary(doc, data.orgName, periodLabel, totalImpressions, totalPosts, totalFollowers, totalIcp, teamAvgPerPost, rows, topCompanies, unattributedIcp)

  // Page 3: Content Leaderboard
  doc.addPage()
  buildLeaderboard(doc, data.orgName, periodLabel, rows, hasIcp)

  // Page 4: Impressions Trend
  if (impressionsTrend.length > 0) {
    doc.addPage()
    buildImpressionsTrend(doc, data.orgName, impressionsTrend)
  }

  // Page 5: ICP Pipeline (only if data exists)
  if (hasIcp) {
    doc.addPage()
    buildIcpPipeline(doc, data.orgName, totalIcp, topCompanies, icpRows, unattributedIcp)
  }

  // Page 6: Back Cover
  doc.addPage()
  buildBackCover(doc)

  // Fill in page numbers retroactively
  const totalPages = doc.getNumberOfPages()
  for (let i = 2; i <= totalPages - 1; i++) { // skip cover and back cover
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...LIGHT_GRAY)
    doc.text(`${i - 1} / ${totalPages - 2}`, PW - 12, PH - 8, { align: 'right' })
  }

  // Download
  const slug = data.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const periodSlug = data.selectedMonth === 'all' ? 'all-time' : data.selectedMonth
  doc.save(`${slug}-linkedin-report-${periodSlug}.pdf`)
}
