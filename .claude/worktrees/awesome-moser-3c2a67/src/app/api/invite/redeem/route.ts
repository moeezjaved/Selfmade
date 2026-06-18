import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'You must be logged in to redeem a code' }, { status: 401 })

    const { code } = await request.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Please enter a code' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Fetch the code
    const { data: invite, error: fetchError } = await admin
      .from('invite_codes')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .single()

    if (fetchError || !invite) {
      return NextResponse.json({ error: 'Invalid invite code. Please check and try again.' }, { status: 400 })
    }

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This invite code has expired.' }, { status: 400 })
    }

    // Check usage
    if (invite.used_count >= invite.max_uses) {
      return NextResponse.json({ error: 'This invite code has already been used the maximum number of times.' }, { status: 400 })
    }

    // Check if user already used an invite code (has an active/trialing subscription or trial_ends_at in future)
    const { data: profile } = await admin
      .from('user_profiles')
      .select('subscription_status, trial_ends_at')
      .eq('user_id', user.id)
      .single()

    if (profile?.subscription_status === 'active') {
      return NextResponse.json({ error: 'You already have an active subscription.' }, { status: 400 })
    }

    // Calculate new trial end date — extend from NOW or from current trial_ends_at (whichever is later)
    const now = new Date()
    const currentTrialEnd = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : now
    const baseDate = currentTrialEnd > now ? currentTrialEnd : now
    const newTrialEnd = new Date(baseDate.getTime() + invite.trial_days * 86400000)

    // Apply the trial extension
    const { error: updateError } = await admin
      .from('user_profiles')
      .update({
        trial_ends_at: newTrialEnd.toISOString(),
        subscription_status: 'trialing',
      })
      .eq('user_id', user.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to apply invite code. Please try again.' }, { status: 500 })
    }

    // Increment used_count
    await admin
      .from('invite_codes')
      .update({ used_count: invite.used_count + 1 })
      .eq('id', invite.id)

    return NextResponse.json({
      ok: true,
      trial_days: invite.trial_days,
      trial_ends_at: newTrialEnd.toISOString(),
      message: `Success! Your trial has been extended by ${invite.trial_days} days.`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
