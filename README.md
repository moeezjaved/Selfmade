# Selfmade — AI-Powered Meta Ads Platform

> Stop guessing. Start winning. AI co-pilot for Meta advertisers.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Payments | Stripe |
| AI | Anthropic Claude (claude-sonnet-4) |
| Meta Ads | Meta Marketing API v20 |
| State | Zustand + React Query |
| Deployment | Vercel |

## Architecture

```
src/
├── app/
│   ├── (auth)/          # Login, Signup, Onboarding, Payment, Connect Meta
│   ├── (dashboard)/     # All authenticated app pages
│   │   ├── dashboard/       # KPIs, recommendations, campaigns
│   │   ├── recommendations/ # Approve/reject AI recommendations
│   │   ├── campaigns/       # Campaign management
│   │   ├── ad-engine/       # Create & launch campaigns
│   │   ├── creative-studio/ # AI creative variation generator
│   │   ├── activity/        # Audit log
│   │   ├── settings/        # Account settings
│   │   └── billing/         # Stripe subscription management
│   └── api/
│       ├── auth/callback    # Meta OAuth callback
│       ├── meta/sync        # Pull data from Meta API
│       ├── recommendations/ # Generate + approve recommendations
│       ├── creative/        # Claude creative generation
│       ├── ads/launch       # Create & launch campaigns on Meta
│       └── webhooks/        # Stripe + Meta webhooks
├── lib/
│   ├── meta/client.ts       # Meta Marketing API wrapper
│   ├── claude/index.ts      # All Claude AI prompts (implements SKILL.md)
│   ├── stripe/index.ts      # Stripe client + webhook handler
│   ├── supabase/            # Supabase client (browser + server)
│   └── utils/               # Shared utilities
├── components/              # Reusable UI components
├── hooks/                   # Custom React hooks
└── types/                   # TypeScript types for entire app
```

## Setup

### 1. Clone and install
```bash
git clone https://github.com/yourname/selfmade.git
cd selfmade
npm install
```

### 2. Environment variables
```bash
cp .env.example .env.local
```
Fill in all values in `.env.local`.

### 3. Supabase setup
```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase (or use cloud)
supabase start

# Run migrations
supabase db push

# Generate TypeScript types
npm run db:types
```

### 4. Stripe setup
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Create products in Stripe dashboard:
# - Selfmade Pro Monthly: $99/month with 7-day trial
# - Selfmade Pro Annual: $948/year ($79/month)
```

### 5. Meta App setup

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a new app → Business type
3. Add "Marketing API" product
4. Request permissions:
   - `ads_management` ← REQUIRED for write access (pause, scale, create)
   - `ads_read`
   - `business_management`
   - `pages_read_engagement`
5. Add your OAuth redirect URI: `http://localhost:3000/api/auth/callback`
6. Copy App ID and App Secret to `.env.local`

### 6. Run development server
```bash
npm run dev
# Open http://localhost:3000
```

## Meta API Permission Notes

Selfmade requires the `ads_management` scope because:
- **Read-only scopes (`ads_read`)** only allow fetching data — you cannot pause, scale, or create ads
- **`ads_management`** grants full read + write access to campaigns, ad sets, and ads
- Every action still requires user approval in Selfmade (approval-first architecture)
- Users can revoke access at any time from Facebook Business Settings

## User Flows

### First-time Advertiser
1. Signup → Email/Google auth
2. Onboarding quiz (business type, niche, experience, budget)
3. Payment → 7-day free trial (Stripe Checkout)
4. Connect Meta → OAuth with full `ads_management` scope
5. Ad Engine → 6-step wizard → Claude runs 5 agents → Preview → Launch
6. Dashboard shows live campaign data

### Experienced Advertiser
1. Login
2. Dashboard syncs existing campaign data from Meta
3. Claude generates recommendations (PAUSE / SCALE / TEST)
4. User approves → Selfmade executes on Meta API in real-time
5. Creative Studio → Pick winning ad → Claude generates 6 variation briefs
6. Ad Engine → Launch new campaigns faster using existing data patterns

## Deployment

### Vercel (recommended)
```bash
npm install -g vercel
vercel
```

Set all environment variables in Vercel dashboard.
Add Stripe webhook endpoint: `https://yourdomain.com/api/webhooks/stripe`
Add Meta OAuth redirect: `https://yourdomain.com/api/auth/callback`

### Database migration in production
```bash
supabase db push --db-url postgres://...
```

## AI Skill Reference

The SKILL.md AI Ads Strategist is implemented in `src/lib/claude/index.ts`:

- `runAdStrategy()` — Runs all 5 agents (Audience, Creative, Funnel, Competitive, Budget)
- `analyzeWinningAd()` — Creative Studio analysis + 6 variation generation
- `generateRecommendations()` — Decision engine for experienced users
- `generateAdCopy()` — Quick copy generation for any campaign

All Claude calls use `claude-sonnet-4-20250514`.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/meta/client.ts` | All Meta Marketing API calls |
| `src/lib/claude/index.ts` | All AI/Claude prompts |
| `src/lib/stripe/index.ts` | Stripe + webhook handling |
| `src/app/api/ads/launch/route.ts` | Full campaign launch (Campaign → AdSet → Creative → Ad) |
| `src/app/api/recommendations/approve/route.ts` | Execute approved recommendations on Meta |
| `supabase/migrations/001_initial_schema.sql` | Full database schema |
| `src/types/index.ts` | All TypeScript types |
| `src/middleware.ts` | Auth protection for all routes |

## Coming Next (Phase 2)

- [ ] Decision engine for experienced users (auto-detect creative fatigue, scaling triggers)
- [ ] Automated daily sync via Supabase Edge Functions (cron job)
- [ ] A/B test tracking and reporting
- [ ] Multi-account management UI
- [ ] Email notifications (Resend)
- [ ] Campaign cloning / duplication
- [ ] Custom audience creation via API
