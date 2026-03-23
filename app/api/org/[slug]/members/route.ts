import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params
  const body = await req.json()
  const { name, role, posts = [], followerHistory = [], icpSignals = [] } = body

  const { data: org } = await getSupabase()
    .from('li_organizations')
    .select('id')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const { data: member, error } = await getSupabase()
    .from('li_members')
    .insert({ org_id: org.id, name, role: role ?? '' })
    .select()
    .single()

  if (error || !member) return NextResponse.json({ error: error?.message }, { status: 500 })

  await getSupabase().from('li_goals').insert({
    member_id: member.id,
    monthly_posts: 8,
    monthly_impressions: 10000,
    monthly_followers: 100,
    monthly_icp_signals: 20,
  })

  if (posts.length > 0) {
    await getSupabase().from('li_posts').insert(
      posts.map((p: Record<string, unknown>) => ({ member_id: member.id, ...flatPost(p) }))
    )
  }
  if (followerHistory.length > 0) {
    await getSupabase().from('li_follower_history').insert(
      followerHistory.map((f: { date: string; newFollowers: number }) => ({
        member_id: member.id, date: f.date, new_followers: f.newFollowers,
      }))
    )
  }
  if (icpSignals.length > 0) {
    await getSupabase().from('li_icp_signals').insert(
      icpSignals.map((s: Record<string, unknown>) => ({ member_id: member.id, ...flatSignal(s) }))
    )
  }

  return NextResponse.json({ id: member.id, addedAt: member.added_at })
}

function flatPost(p: Record<string, unknown>) {
  return {
    date: p.date, url: p.url ?? null,
    impressions: p.impressions ?? 0, clicks: p.clicks ?? 0,
    likes: p.likes ?? 0, comments: p.comments ?? 0,
    shares: p.shares ?? 0, follows: p.follows ?? 0,
    engagements: p.engagements ?? 0, engagement_rate: p.engagementRate ?? 0,
  }
}

function flatSignal(s: Record<string, unknown>) {
  return {
    date: s.date, name: s.name ?? null, company: s.company ?? null,
    title: s.title ?? null, action: s.action ?? '', source: s.source ?? null,
    is_icp: s.isIcp ?? false,
  }
}
