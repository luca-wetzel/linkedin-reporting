import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

// PUT: upsert goals for all members of this org
export async function PUT(req: NextRequest, { params }: { params: { slug: string } }) {
  const goals: Record<string, {
    monthlyPosts: number
    monthlyImpressions: number
    monthlyFollowers: number
    monthlyIcpSignals: number
  }> = await req.json()

  const rows = Object.entries(goals).map(([memberId, g]) => ({
    member_id: memberId,
    monthly_posts: g.monthlyPosts,
    monthly_impressions: g.monthlyImpressions,
    monthly_followers: g.monthlyFollowers,
    monthly_icp_signals: g.monthlyIcpSignals,
  }))

  if (rows.length > 0) {
    await getSupabase().from('li_goals').upsert(rows, { onConflict: 'member_id' })
  }

  return NextResponse.json({ ok: true })
}
