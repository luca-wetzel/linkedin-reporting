import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buf)

  const find = (...kw: string[]) =>
    wb.SheetNames.find(n => kw.some(k => n.toLowerCase().includes(k)))

  const posts: object[] = []
  const followerHistory: object[] = []
  const detectedColumns: string[] = []

  // TOP POSTS sheet — two side-by-side tables
  // Left:  col0=Post URL, col1=Post publish date, col2=Engagements
  // Right: col4=Post URL, col5=Post publish date, col6=Impressions
  const topName = find('top post', 'top_post', 'posts')
  if (topName) {
    const raw = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[topName], { header: 1, raw: false, defval: '' }) as string[][]
    const hi = Math.max(0, raw.findIndex(r => r.join(' ').toLowerCase().includes('post url')))
    detectedColumns.push(...(raw[hi] ?? []).filter(Boolean))
    const postMap = new Map<string, { url: string; date: string; engagements: number; impressions: number }>()
    const n = (v: string) => parseFloat((v ?? '').replace(/[^0-9.]/g, '')) || 0
    for (let i = hi + 1; i < raw.length; i++) {
      const row = raw[i]
      const urlL = (row[0] ?? '').trim(), dateL = (row[1] ?? '').trim()
      if (urlL && dateL) {
        const existing = postMap.get(urlL) ?? { url: urlL, date: dateL, engagements: 0, impressions: 0 }
        postMap.set(urlL, { ...existing, url: urlL, date: dateL, engagements: n(row[2]) })
      }
      const urlR = (row[4] ?? '').trim(), dateR = (row[5] ?? '').trim()
      if (urlR && dateR) {
        const existing = postMap.get(urlR) ?? { url: urlR, date: dateR, engagements: 0, impressions: 0 }
        postMap.set(urlR, { ...existing, url: urlR, date: dateR, impressions: n(row[6]) })
      }
    }
    for (const p of postMap.values()) {
      if (!p.date) continue
      const imp = p.impressions ?? 0, eng = p.engagements ?? 0
      posts.push({
        date: p.date, url: p.url, impressions: imp, engagements: eng,
        engagementRate: imp > 0 ? (eng / imp) * 100 : 0,
        clicks: 0, likes: 0, comments: 0, shares: 0, follows: 0,
      })
    }
  }

  // FOLLOWERS sheet — Date | New followers
  const folName = find('follower')
  if (folName) {
    const raw = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[folName], { header: 1, raw: false, defval: '' }) as string[][]
    const hi = raw.findIndex(r => { const s = r.join(' ').toLowerCase(); return s.includes('date') && s.includes('follower') })
    if (hi >= 0) {
      for (let i = hi + 1; i < raw.length; i++) {
        const date = (raw[i][0] ?? '').trim()
        const nf = parseFloat((raw[i][1] ?? '').replace(/[^0-9.]/g, '')) || 0
        if (date) followerHistory.push({ date, newFollowers: nf })
      }
    }
  }

  const validPosts = (posts as Array<{ impressions: number; engagements: number }>)
    .filter(p => p.impressions > 0 || p.engagements > 0)

  return NextResponse.json({ posts: validPosts, followerHistory, detectedColumns })
}
