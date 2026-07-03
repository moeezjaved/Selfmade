/**
 * Persist an AI-generated creative so it shows up in "My Creatives".
 * Decodes the base64 image, uploads it to R2, and inserts a creative_generations row.
 * Best-effort: if R2 isn't configured or the upload fails, returns null and the caller still
 * returns the inline data URL (the user gets their image; it just isn't saved to the gallery).
 */
import { uploadBufferToR2 } from '@/lib/r2'
import { createAdminClient } from '@/lib/supabase/server'

export type SaveGenerationInput = {
  userId: string
  dataB64: string
  mimeType: string
  type: 'clone' | 'edit' | 'inspired'
  tier?: 'default' | 'pro'
  brandId?: string | null
  sourceAdId?: string | null
  parentId?: string | null
  prompt?: string | null
}

function keyFor(userId: string, ext: string) {
  // Unique-ish key without Date.now/Math.random dependence issues in edge/runtime: user + hrtime.
  const rand = Buffer.from(`${userId}:${process.hrtime.bigint()}`).toString('hex').slice(0, 24)
  return `creatives/${userId}/${rand}.${ext}`
}

export async function saveGeneration(input: SaveGenerationInput): Promise<{ id: string; url: string } | null> {
  try {
    const buf = Buffer.from(input.dataB64, 'base64')
    const ext = input.mimeType.includes('png') ? 'png' : input.mimeType.includes('webp') ? 'webp' : 'jpg'
    const url = await uploadBufferToR2(buf, keyFor(input.userId, ext), input.mimeType || 'image/png')
    if (!url) {
      console.warn('saveGeneration: R2 upload returned null — is R2 configured on this deploy? (R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET_NAME/PUBLIC_URL)')
      return null
    }

    const admin = createAdminClient()
    const { data, error } = await admin.from('creative_generations').insert({
      user_id: input.userId,
      brand_id: input.brandId || null,
      source_ad_id: input.sourceAdId || null,
      parent_id: input.parentId || null,
      type: input.type,
      tier: input.tier || 'default',
      prompt: input.prompt || null,
      image_url: url,
    }).select('id').single()
    if (error || !data) { console.warn('saveGeneration: insert failed:', error?.message); return null }
    return { id: (data as any).id, url }
  } catch (e: any) {
    console.warn('saveGeneration: threw:', String(e?.message || e))
    return null
  }
}
