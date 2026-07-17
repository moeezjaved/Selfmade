import { createAdminClient } from '@/lib/supabase/server'

/**
 * Lightweight per-user BURST limiter for expensive generation endpoints (image/video clone, edits).
 *
 * There's no Redis/Upstash in this stack, so this is DB-backed: it counts the user's own recent
 * `creative_generations` rows and rejects sustained bursts. It's a burst guard, not a hard quota —
 * paid actions are already credit-bounded server-side; this exists mainly because IMAGES are free for
 * subscribers (`imagesAreFree`), so without it a subscriber could script unlimited generations and
 * amplify Gemini cost + worker load.
 *
 * FAIL-OPEN by design: if the counting query errors or times out, it returns false (allow). The
 * money/creation flow must never break because the limiter itself hiccuped.
 */
export async function isRateLimited(
  userId: string,
  opts?: { windowSec?: number; max?: number },
): Promise<boolean> {
  const windowSec = opts?.windowSec ?? 60
  const max = opts?.max ?? 40   // generous: a few 8-variation bursts still pass; only scripted floods trip it
  try {
    const admin = createAdminClient() as any
    const since = new Date(Date.now() - windowSec * 1000).toISOString()
    const { count, error } = await admin
      .from('creative_generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since)
    if (error) return false
    return (count ?? 0) >= max
  } catch {
    return false
  }
}
