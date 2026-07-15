/**
 * Feature flags. META_LIVE gates every surface that needs a CONNECTED Meta ad account
 * (Launch Ads, Campaigns, Scale & Insights, Reports, Snapshots, Leaderboard, KPI Dashboard,
 * Connect Meta). The original Meta app was lost (account hack) and the replacement app is in
 * Facebook review (~20 days) — until it's approved, OAuth is dead and these pages can't work,
 * so they show a Coming-soon teaser instead of erroring. Flip ON by setting
 * NEXT_PUBLIC_META_LIVE=1 in Vercel and redeploying — nothing was removed.
 */
export const META_LIVE = process.env.NEXT_PUBLIC_META_LIVE === '1'
