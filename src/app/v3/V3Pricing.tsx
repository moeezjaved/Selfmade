/**
 * V3Pricing — the pricing cards in the v3 landing look (white cards, Inter, orange accent), replacing
 * the cream in-app PricingSection on marketing surfaces. Numbers come from plans.ts / ACTION_COSTS so
 * they never drift from billing. Purely presentational (CTAs are plain links → /signup), so it drops
 * into both the client landing and the server /pricing page. Inherits --orange/--ink/--soft from the
 * surrounding .v3 or .pg scope and bundles its own layout CSS.
 */
import { ACTION_COSTS } from '@/lib/plans'

const IMG = (ACTION_COSTS.image_clone_pro / 100).toFixed(2)   // 1 credit = 1¢
const VID = String(Math.round(ACTION_COSTS.video_clone / 100))

type Card = { id: string; tier: string; price: string; per: string; note: string; cta: string; href: string; feats: string[]; popular?: boolean }
const CARDS: Card[] = [
  {
    id: 'free', tier: 'Free', price: '$0', per: '', note: 'No card needed', cta: 'Start free', href: '/signup',
    feats: ['75 free credits (~5 image ads)', '1 brand · 1 competitor to spy on', 'Discovery + Brand Spy + remake ads', 'Daily brief from Mello', 'Solo workspace — 1 seat'],
  },
  {
    id: 'starter', tier: 'Creator', price: '$49', per: '/mo', note: 'Mello, full-time — everything, every morning', cta: 'Go full-time', href: '/signup?plan=starter', popular: true,
    feats: [`6,000 credits/mo · $${IMG} image · $${VID} video`, '15 brands · 15 competitors to spy on', 'Connect Meta & run your ads', 'Invite your team — 3 seats', 'Customer inbox + fresh creatives daily'],
  },
]

const CSS = `
.v3pl{max-width:860px;margin:0 auto}
.v3pl-chips{display:flex;gap:12px;justify-content:center;margin:0 0 30px;flex-wrap:wrap}
.v3pl-chip{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--hair,#eee);border-radius:100px;padding:9px 17px;font-size:14px;color:var(--soft,#5c5c58);box-shadow:0 1px 2px rgba(20,29,21,.04)}
.v3pl-chip b{color:var(--ink,#0d0d0d);font-size:18px;letter-spacing:-.02em}
.v3pl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(290px,100%),1fr));gap:18px;align-items:stretch}
.v3pl-card{background:#fff;border:1px solid var(--line,#ececE6);border-radius:20px;padding:30px 28px;display:flex;flex-direction:column;position:relative}
.v3pl-card.pop{border-color:var(--orange,#ff5a2c);box-shadow:0 24px 60px -28px rgba(255,90,44,.55)}
.v3pl-badge{position:absolute;top:-12px;left:28px;background:var(--orange,#ff5a2c);color:#fff;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;border-radius:100px}
.v3pl-tier{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--orange,#ff5a2c)}
.v3pl-price{display:flex;align-items:baseline;gap:5px;margin:12px 0 2px}
.v3pl-price b{font-size:44px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--ink,#0d0d0d)}
.v3pl-price span{font-size:16px;color:var(--soft,#5c5c58);font-weight:600}
.v3pl-note{font-size:13.5px;color:var(--soft,#5c5c58);min-height:38px;margin:8px 0 18px;line-height:1.4}
.v3pl-btn{display:block;text-align:center;padding:14px;border-radius:12px;font-weight:700;font-size:15px;margin-bottom:22px;border:1px solid;transition:.15s;text-decoration:none}
.v3pl-btn.solid{background:var(--orange,#ff5a2c);color:#fff;border-color:var(--orange2,#ef4a1e)}
.v3pl-btn.solid:hover{background:var(--orange2,#ef4a1e)}
.v3pl-btn.ghost{background:#fff;color:var(--ink,#0d0d0d);border-color:var(--line,#e6e6df)}
.v3pl-btn.ghost:hover{border-color:var(--ink,#0d0d0d)}
.v3pl-feats{display:flex;flex-direction:column;gap:12px;font-size:14px;color:#3a3a36;margin-top:auto}
.v3pl-feats div{display:flex;gap:10px;align-items:flex-start;line-height:1.4}
.v3pl-tick{color:var(--orange,#ff5a2c);font-weight:800;flex-shrink:0}
`

export function V3Pricing() {
  return (
    <div className="v3pl">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="v3pl-chips">
        <div className="v3pl-chip"><span style={{ fontSize: 18 }}>🖼️</span> Image ad <b>${IMG}</b></div>
        <div className="v3pl-chip"><span style={{ fontSize: 18 }}>🎬</span> Video ad <b>${VID}</b></div>
      </div>
      <div className="v3pl-grid">
        {CARDS.map((c) => (
          <div key={c.id} className={`v3pl-card${c.popular ? ' pop' : ''}`}>
            {c.popular && <div className="v3pl-badge">Most popular</div>}
            <div className="v3pl-tier">{c.tier}</div>
            <div className="v3pl-price"><b>{c.price}</b>{c.per && <span>{c.per}</span>}</div>
            <div className="v3pl-note">{c.note}</div>
            <a className={`v3pl-btn ${c.popular ? 'solid' : 'ghost'}`} href={c.href}>{c.cta}</a>
            <div className="v3pl-feats">
              {c.feats.map((f, i) => <div key={i}><span className="v3pl-tick">✓</span><span>{f}</span></div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
