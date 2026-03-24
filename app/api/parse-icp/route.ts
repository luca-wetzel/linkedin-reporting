import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

function findVal(row: Record<string, string>, keys: string[]): string {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase().trim()] = String(v ?? '').trim()
  for (const k of keys) {
    if (lower[k] !== undefined) return lower[k]
  }
  return ''
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buf)
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return NextResponse.json({ signals: [] })

  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[sheetName], { defval: '' })

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

  return NextResponse.json({ signals })
}
