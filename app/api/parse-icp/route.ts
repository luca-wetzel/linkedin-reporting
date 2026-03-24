import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

type Row = Record<string, string>

function findVal(row: Row, keys: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const k of keys) {
    const nk = norm(k)
    const found = Object.keys(row).find(rk => norm(rk) === nk || norm(rk).includes(nk))
    if (found && row[found] !== undefined) return String(row[found] ?? '').trim()
  }
  return ''
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

function parseGojiberryRow(row: Row) {
  const firstName = findVal(row, ['first name', 'firstname'])
  const lastName = findVal(row, ['last name', 'lastname'])
  const name = [firstName, lastName].filter(Boolean).join(' ') || undefined

  const rawDate = findVal(row, ['last touch date', 'lasttouchdate'])
  // Excel may give a serial number or a date string
  const date = rawDate ? String(rawDate).split(/[\sT]/)[0] : ''
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

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buf, { cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return NextResponse.json({ signals: [] })

  const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { defval: '', raw: false })

  const detectedColumns = rows.length > 0 ? Object.keys(rows[0]) : []
  const isGoji = isGojiberryFormat(rows)

  if (isGoji) {
    const signals = rows.map(parseGojiberryRow).filter(s => s !== null && s.date)
    return NextResponse.json({ signals, _debug: { format: 'gojiberry', columns: detectedColumns, rowCount: rows.length } })
  }

  const signals = rows.map(row => {
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

  return NextResponse.json({ signals, _debug: { format: 'standard', columns: detectedColumns, rowCount: rows.length } })
}
