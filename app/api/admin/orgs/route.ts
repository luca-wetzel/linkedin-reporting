import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return pw === process.env.ADMIN_PASSWORD
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await getSupabase().from('li_organizations').select('id, slug, name, created_at').order('created_at')
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug, name } = await req.json()
  if (!slug || !name) return NextResponse.json({ error: 'slug and name required' }, { status: 400 })
  const { data, error } = await getSupabase().from('li_organizations').insert({ slug, name }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
