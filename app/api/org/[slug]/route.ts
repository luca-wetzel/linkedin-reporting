import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params

  const { data: org } = await getSupabase()
    .from('li_organizations')
    .select('id, slug, name')
    .eq('slug', slug)
    .single()

  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const { data: members } = await getSupabase()
    .from('li_members')
    .select('id, name, role, added_at')
    .eq('org_id', org.id)
    .order('added_at')

  if (!members || members.length === 0) {
    return NextResponse.json({ org, members: [], goals: {} })
  }

  const memberIds = members.map(m => m.id)

  const [postsRes, followersRes, icpRes, goalsRes] = await Promise.all([
    getSupabase().from('li_posts').select('*').in('member_id', memberIds),
    getSupabase().from('li_follower_history').select('*').in('member_id', memberIds),
    getSupabase().from('li_icp_signals').select('*').in('member_id', memberIds),
    getSupabase().from('li_goals').select('*').in('member_id', memberIds),
  ])

  const posts = postsRes.data ?? []
  const followers = followersRes.data ?? []
  const icpSignals = icpRes.data ?? []
  const goalRows = goalsRes.data ?? []

  const goals: Record<string, object> = {}
  for (const g of goalRows) {
    goals[g.member_id] = {
      monthlyPosts: g.monthly_posts,
      monthlyImpressions: g.monthly_impressions,
      monthlyFollowers: g.monthly_followers,
      monthlyIcpSignals: g.monthly_icp_signals,
    }
  }

  const fullMembers = members.map(m => ({
    id: m.id,
    name: m.name,
    role: m.role,
    addedAt: m.added_at,
    posts: posts.filter(p => p.member_id === m.id).map(p => ({
      date: p.date, url: p.url, impressions: +p.impressions, clicks: +p.clicks,
      likes: +p.likes, comments: +p.comments, shares: +p.shares, follows: +p.follows,
      engagements: +p.engagements, engagementRate: +p.engagement_rate,
    })),
    followerHistory: followers.filter(f => f.member_id === m.id).map(f => ({
      date: f.date, newFollowers: +f.new_followers,
    })),
    icpSignals: icpSignals.filter(s => s.member_id === m.id).map(s => ({
      date: s.date, name: s.name, company: s.company, title: s.title,
      action: s.action, source: s.source, isIcp: s.is_icp,
    })),
  }))

  return NextResponse.json({ org, members: fullMembers, goals })
}
