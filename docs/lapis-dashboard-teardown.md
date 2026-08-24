# Lapis Dashboard Teardown → Selfmade Ads Section Spec

Studied live (logged-in as Aura) at trylapis.com/dashboard on 2026-08-24. This is the target
UI/UX for rebuilding Selfmade's ads section: **simple, clean, in our orange**. Data is REAL
(auto-imported catalog, auto-discovered competitors with real Meta ads, AI audiences).

## 0. Design language (what makes it feel simple)
- Left sidebar (light, ~250px), big white content viewport, optional right rail (History / chat).
- Serif display headings (e.g. "Start with an idea", section titles), Inter-ish body.
- Very flat: white cards, hairline borders, generous whitespace, one black primary button
  ("Create New Ad", "Import from Website", "Add Audience"). No heavy shadows/gradients.
- We swap black accents/primary → our orange (#e02f06 / #ef4a1e), keep the cream/white base.

## 1. Navigation (sidebar, 3 groups)
- **(top)** Home · Search · Your Ads
- **Insights**: My Competitors · Discover · Products
- **Tools**: Calendar · Brand Kit · Audiences · Google Ads · ChatGPT Ads (locked)
- Footer: credits pill (e.g. "10 credits") · user + brand (Moeez Javed / Aura)

## 2. Sections in detail

### Home  (/dashboard)
- Hero "Start with an idea".
- Channel chips: Banner Ad · WhatsApp · Instagram · Facebook · LinkedIn (pick the format).
- Prompt box: textarea ("A vibrant summer sale banner…") + "+" attach, **Aspect Ratio** dropdown,
  **Language** dropdown, send. This is the entry to the marketing-agent chat.
- Suggestion chips: "Create an Instagram ad campaign", "Build a content calendar for next week",
  "Generate ad creatives for my product", "Design a product launch campaign", "Create a LinkedIn
  thought leadership post", "Make a WhatsApp promotional banner", "Design a seasonal sale campaign".
- **Discover** strip below ("Trending creative from across the community", numbered 01/02/03 cards).
- Right rail: **History** (Today → past chats/campaigns w/ timestamps).

### Search  (overlay)
- Command-palette modal: "Search by headline, prompt, or description…" → "Start typing to search
  your ads · N ads available". Global quick-find across your generated ads.

### Your Ads  (/dashboard/ads)
- Title + **Create New Ad** (primary). Search bar "Search your ads…".
- **Recent** row: horizontal thumbnails w/ ‹ › arrows.
- Grid of ad cards: creative image + title (e.g. "Product photography of…") + date + **Download** /
  **Share** + edit (pencil). This is the ad library/output store.

### My Competitors  (/dashboard/competitors)   ← the standout
- Title + "Search competitors…".
- Per competitor (auto-discovered): logo + name (e.g. **Füm**) + external-link + "N ads" badge.
- One-line AI **positioning summary** vs you ("Füm offers a nearly identical non-electronic,
  nicotine-free flavored air device … same 'Journey Pack' positioning as Aura, directly targeting
  people quitting smoking and vaping.").
- Horizontal scroll of the competitor's **real running ads** (from Meta ad library): FB+IG icons,
  carousel "1/6 · 6 images", the actual ad caption, "See more".
- **Selfmade advantage:** we already have the ad-DNA crawl (millions of classified ads) + Meta —
  this is our strongest surface. We can do this deeper than Lapis (angles/hooks/personas from the crawl).

### Discover  (/dashboard/discover)
- Community ad-inspiration gallery. Search "Search ads by brand, product, style…" + filters:
  **Industry · Theme · Brand**. Grid of ad cards. (≈ our existing inspiration/Discovery library.)

### Products  (/dashboard/products)
- "We detected N products on your website." + **Upload** / **Import from Website**. Search.
- Grid of auto-imported product cards (image + name), each with a **checkbox** to select →
  generate ads for those products. (We have this via Shopify connection already.)

### Calendar  (/dashboard/calendar)  — gated (paid)
- "Content Calendar by Marketing Agent — Plan and generate content across every platform."
- Platforms: Instagram · Facebook · LinkedIn · TikTok · Twitter.
- What you get: AI Content Planning (calendars w/ themes, copy, creative prompts) · Multi-Platform
  Content (posts, stories, reels, carousels, email, blog headers) · Auto-Generated Creatives
  (image + platform-specific copy per post) · Day/Week/Month views · Export as ZIP.

### Brand Kit  (/dashboard/brand)
- "Manage the visual identity and knowledge Lapis uses for [brand]." Tabs:
  - **Visual Brand Kit**: Your logo (Change) · "Your visual world" reference images (Add) — shapes design.
  - **Knowledge Base**: brand facts/tone/copy the agent uses.
- Feeds every generation. (We have Company Brain — reuse it as this.)

### Audiences  (/dashboard/audiences)
- "We identified N target audiences for your brand." + **Add Audience**.
- Cards: "Audience N" + name (Urban Vape Quitters, Stressed Uni Students…) + "6 insights" +
  rich bullet insights (demographics, behavior, pain points, values, shopping habits, why-it-appeals)
  + delete. Editable/addable. These drive per-audience ad variants.

### Google Ads  (/dashboard/google) — gated (paid)
- "Generate Google Ads campaigns — keywords, ad copy, bid strategy." AI Keyword Research ·
  Campaign Generation (ad groups + keywords) · Ad Copy Creation. (We already have DataForSEO keywords.)

### ChatGPT Ads — locked / coming soon.

## 3. The core creation flow (marketing-agent chat)  /dashboard/marketing-agent/chat/{id}
Layout = 3 columns:
- **Left**: Templates rail with tabs (Templates · Discover · VIBE Kits · Elements · Products) and a
  scrollable set of **templates**: Product Showcase, Social Media Story, Sale Campaign, Lifestyle
  Scene, Brand Awareness, Feature Highlight, LinkedIn B2B Ad, Testimonial Ad, Event Promotion,
  Free Trial CTA. (Personalized to the brand — each rendered with the brand's product/logo.)
- **Center**: the selected ad preview (big) + **Ad Score** ring (e.g. "69 · Average", expandable) +
  **Download** / **Improve** buttons + **CONTEXT** (which template) + **HISTORY** (variant thumbnails).
- **Right**: the agent chat — explains the batch ("Generated 5 images (5 credits used, 10
  remaining)"), lists the **audience segments** it targeted with a headline + target + "View in
  preview" per segment (e.g. 1. Urban Vape Quitters → "Break Free From Vaping…", 2. Stressed Uni
  Students → "Study Smarter, Stress Less…", 3. Health-Conscious Professionals…), and a prompt box
  "Describe changes you want…" (+ attach, image, globe) → iterate. **Save to Calendar** button.
- Onboarding modal on first generate: "Your ads are being generated — 5 custom ad images based on
  your brand… while you wait, let us show you around!" (carousel tour, Next).

## 4. How it all connects (the data graph — this is the important part)
Import once → everything is auto-populated → the agent composes:

    Website/Shopify ──▶ Products (catalog)        ┐
    Website + logo ───▶ Brand Kit (visual + KB)   ├─▶  MARKETING AGENT (chat)
    Category/site ────▶ Audiences (5 ICP segments)│     picks Template + Product + Audience
    SERP/ad crawl ────▶ My Competitors (real ads) ┘     → generates N ad variants (1 per audience)
                                                          → each gets an Ad Score
                                                          → saved to Your Ads (library)
                                                          → schedule via Calendar
                                                          → (Google Ads / ChatGPT Ads = other channels)

Everything downstream needs zero setup — it's derived from the domain the way our /audit scan already
derives health/catalog/competitors. **The ads section is the post-audit destination:** after the SEO
audit, the user lands here with Products, Brand Kit, Audiences, and Competitors already filled from
the same crawl, and the agent proposes the first batch of on-brand ads.

## 5. Selfmade adaptation notes
- Keep it THIS simple (flat, white, serif headings) but in our orange; reuse /audit's visual language.
- Reuse what we already have: Shopify catalog → Products; Company Brain → Brand Kit/Knowledge Base;
  DataForSEO + ad-DNA crawl → Competitors (deeper than Lapis) + Discover; DNA engine → Audiences.
- Meta integration → optional one-click "launch" from a finished ad (our edge over Lapis, which stops
  at download/schedule).
- Entry point: the SEO audit report's "fix/grow" CTA → this ads workspace, pre-populated.
