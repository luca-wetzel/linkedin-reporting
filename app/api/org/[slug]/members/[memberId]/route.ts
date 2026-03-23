import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

type Ctx = { params: { slug: string; memberId: string } }

// PATCH: update name/role and/or replace posts/followers/icp
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { memberId } = params
  const body = await req.json()

  // Update name/role if provided
  if (body.name !== undefined || body.role !== undefined) {
    const patch: Record<string, string> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.role !== undefined) patch.role = body.role
    await getSupabase().from('li_members').update(patch).eq('id', memberId)
  }

  // Replace posts if provided
  if (body.posts !== undefined) {
    await getSupabase().from('li_posts').delete().eq('member_id', memberId)
    if (body.posts.length > 0) {
      await getSupabase().from('li_posts').insert(
        body.posts.map((p: Record<string, unknown>) => ({
          member_id: memberId,
          date: p.date, url: p.url ?? null,
          impressions: p.impressions ?? 0, clicks: p.clicks ?? 0,
          likes: p.likes ?? 0, comments: p.comments ?? 0,
          shares: p.shares ?? 0, follows: p.follows ?? 0,
          engagements: p.engagements ?? 0, engagement_rate: p.engagementRate ?? 0,
        }))
      )
    }
  }

  // Replace follower history if provided
  if (body.followerHistory !== undefined) {
    await getSupabase().from('li_follower_history').delete().eq('member_id', memberId)
    if (body.followerHistory.length > 0) {
      await getSupabase().from('li_follower_history').insert(
        body.followerHistory.map((f: { date: string; newFollowers: number }) => ({
          member_id: memberId, date: f.date, new_followers: f.newFollowers,
        }))
      )
    }
  }

  // Replace ICP signals if provided
  if (body.icpSignals !== undefined) {
    await getSupabase().from('li_icp_signals').delete().eq('member_id', memberId)
    if (body.icpSignals.length > 0) {
      await getSupabase().from('li_icp_signals').insert(
        body.icpSignals.map((s: Record<string, unknown>) => ({
          member_id: memberId,
          date: s.date, name: s.name ?? null, company: s.company ?? null,
          title: s.title ?? null, action: s.action ?? '', source: s.source ?? null,
          is_icp: s.isIcp ?? false,
        }))
      )
    }
  }

  return NextResponse.json({ ok: true })
}

// DELETE: remove member (cascades posts/followers/icp/goals)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { memberId } = params
  await getSupabase().from('li_members').delete().eq('id', memberId)
  return NextResponse.json({ ok: true })
}
