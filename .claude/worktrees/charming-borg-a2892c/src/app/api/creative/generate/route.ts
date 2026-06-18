import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runAdStrategy, analyzeWinningAd, generateAdCopy } from '@/lib/claude'

// POST /api/creative/generate
// Handles 3 types: 'strategy' | 'analyze' | 'copy'
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { type } = body

    switch (type) {

      // ── Run full 5-agent strategy (Ad Engine Step 5) ──────────
      case 'strategy': {
        const {
          campaignName, objective, landingUrl,
          productDescription, dailyBudget,
          location, ageMin, ageMax, gender,
          interests, competitors, competitorInsights,
        } = body

        const result = await runAdStrategy({
          campaignName,
          objective,
          landingUrl,
          productDescription,
          dailyBudget,
          location,
          ageMin,
          ageMax,
          gender,
          interests,
          competitors,
          competitorInsights,
        })

        return NextResponse.json({ result })
      }

      // ── Analyze winning ad (Creative Studio) ──────────────────
      case 'analyze': {
        const {
          adName, campaign, headline, primaryText,
          cta, visual, offer, roas, ctr, cpa, spend,
          competitors, competitorSummary,
        } = body

        const result = await analyzeWinningAd({
          adName, campaign, headline, primaryText,
          cta, visual, offer, roas, ctr, cpa, spend,
          competitors, competitorSummary,
        })

        // Save to DB
        const admin = createAdminClient()
        const { data: saved } = await admin
          .from('creative_analyses')
          .insert({
            user_id: user.id,
            product: campaign,
            winning_analysis: result.winning_analysis,
            competitor_analysis: result.competitor_analysis,
            strategy: result.strategy,
            variations: result.variations,
          })
          .select()
          .single()

        return NextResponse.json({ result, id: saved?.id })
      }

      // ── Generate ad copy only ─────────────────────────────────
      case 'copy': {
        const { product, audience, objective, tone, competitors } = body

        const variations = await generateAdCopy({
          product, audience, objective, tone, competitors,
        })

        return NextResponse.json({ variations })
      }

      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

  } catch (err) {
    console.error('Creative generation error:', err)
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
