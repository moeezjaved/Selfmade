'use client'
import { useState, useEffect, useRef, type FormEvent } from 'react'

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
.v3{--bg:#ffffff;--bg2:#f7f6f2;--ink:#0d0d0d;--soft:#5c5c58;--fog:#8b8b86;--line:#ececE6;--hair:#f2f1ec;--orange:#ff5a2c;--orange2:#ef4a1e;--white:#ffffff;--tan:#f4f1ea;
  --sans:'Inter',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;--mono:'Space Mono',ui-monospace,Menlo,monospace;--serif:'Instrument Serif','Iowan Old Style',Georgia,serif;
  background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
.v3 *{box-sizing:border-box}
.v3 a{color:inherit;text-decoration:none}
.v3-shell{max-width:1180px;margin:0 auto;padding:0 26px}
.v3-eye{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--orange2)}
.v3-ann{background:var(--orange);color:#fff;text-align:center;font-size:13.5px;font-weight:600;padding:10px 16px}
.v3-nav{position:sticky;top:0;z-index:40;background:rgba(250,248,243,.86);backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid var(--hair)}
.v3-nav-in{display:flex;align-items:center;justify-content:space-between;height:64px}
.v3-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:19px;letter-spacing:-.02em}
.v3-spark{color:var(--orange)}
.v3-links{display:flex;align-items:center;gap:28px;font-size:14.5px;font-weight:600;color:var(--soft)}
.v3-links>a:hover{color:var(--ink)}
.v3-drop{position:relative}
.v3-dropbtn{font:inherit;font-weight:600;color:var(--soft);background:none;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.v3-drop:hover .v3-dropbtn,.v3-drop:focus-within .v3-dropbtn{color:var(--ink)}
.v3-caret{font-size:10px;transition:transform .15s}
.v3-drop:hover .v3-caret,.v3-drop:focus-within .v3-caret{transform:rotate(180deg)}
.v3-menu{position:absolute;top:calc(100% + 12px);left:-16px;width:320px;background:#fff;border:1px solid var(--hair);border-radius:14px;box-shadow:0 12px 40px -12px rgba(20,29,21,.22);padding:8px;opacity:0;visibility:hidden;transform:translateY(-6px);transition:.16s;z-index:50}
.v3-menu::before{content:"";position:absolute;top:-12px;left:0;right:0;height:12px}
.v3-drop:hover .v3-menu,.v3-drop:focus-within .v3-menu{opacity:1;visibility:visible;transform:translateY(0)}
.v3-menu a{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:9px;color:var(--ink);transition:background .12s}
.v3-menu a:hover{background:var(--sky,#f3f6fb)}
.v3-menu a b{font-size:14px;font-weight:700}
.v3-menu a span{font-size:12.5px;font-weight:500;color:var(--soft);line-height:1.35}
@media(max-width:860px){.v3-links{display:none}}
.v3-navr{display:flex;align-items:center;gap:14px}
.v3-login{font-size:14.5px;font-weight:600;color:var(--soft)}
.v3-btn{background:var(--orange);color:#fff;font-weight:700;font-size:14.5px;padding:10px 18px;border-radius:9px;border:1px solid var(--orange2);transition:.15s;display:inline-flex;align-items:center;gap:7px;cursor:pointer}
.v3-btn:hover{background:var(--orange2)}
/* hero */
.v3-hero{position:relative;overflow:hidden;padding:74px 0 30px}
.v3-grid{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.5;background-image:linear-gradient(var(--hair) 1px,transparent 1px),linear-gradient(90deg,var(--hair) 1px,transparent 1px);background-size:34px 34px;mask-image:radial-gradient(ellipse 80% 60% at 50% 32%,#000 30%,transparent 78%)}
.v3-hero-in{position:relative;z-index:1;text-align:center;max-width:880px;margin:0 auto}
.v3-pill{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--orange2);background:var(--white);border:1px solid var(--line);padding:7px 14px;border-radius:999px;margin-bottom:26px}
.v3-h1{font-size:clamp(40px,6.6vw,74px);line-height:.98;font-weight:800;letter-spacing:-.035em}
.v3-h1 em{font-style:normal;color:var(--orange)}
.v3-sub{margin:22px auto 0;max-width:640px;font-size:19px;line-height:1.5;color:var(--soft)}
.v3-prompt{margin:34px auto 0;max-width:660px;background:var(--white);border:1px solid var(--line);border-radius:16px;box-shadow:0 14px 40px rgba(23,21,15,.08);padding:14px 14px 14px 20px}
.v3-toggle{display:flex;gap:6px;margin-bottom:12px}
.v3-tog{cursor:pointer;font-size:13px;font-weight:700;padding:8px 14px;border-radius:999px;color:var(--soft);background:var(--bg2);border:1px solid transparent;transition:.15s}
.v3-tog.on{background:var(--ink);color:#fff}
.v3-prow{display:flex;align-items:center;gap:10px}
.v3-input{flex:1;border:none;outline:none;background:transparent;font-size:16px;color:var(--ink);font-family:var(--sans);min-width:0}
.v3-input::placeholder{color:var(--fog)}
.v3-go{white-space:nowrap;background:var(--orange);color:#fff;font-weight:700;font-size:15px;padding:12px 20px;border-radius:11px;border:1px solid var(--orange2);cursor:pointer;transition:.15s}
.v3-go:hover{background:var(--orange2)}
.v3-fine{margin-top:16px;font-size:13px;color:var(--fog);display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.v3-fine b{color:var(--soft);font-weight:600}
.v3-trust{margin-top:52px;padding:26px 0 8px;border-top:1px solid var(--hair)}
.v3-trust-lab{text-align:center;font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--fog);margin-bottom:18px}
.v3-logos{display:flex;align-items:center;justify-content:center;gap:34px;flex-wrap:wrap}
.v3-logos img{height:20px;width:auto;filter:brightness(0);opacity:.4}
.v3-shopify{height:22px!important;filter:none!important;opacity:1!important}
/* animated logo marquee */
.v3-marquee{margin-top:8px;overflow:hidden;position:relative;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.v3-track{display:flex;align-items:center;gap:60px;width:max-content;animation:v3scroll 32s linear infinite}
.v3-marquee:hover .v3-track{animation-play-state:paused}
.v3-track img{height:24px;width:auto;flex:0 0 auto;filter:brightness(0);opacity:.36}
.v3-track .v3-mshopify{filter:none;opacity:1}
@keyframes v3scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.v3-track{animation:none}}
/* animated hero background (firecrawl-style: grid + drift + wireframes + sparks) */
.v3-bg{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.v3-shimmer{position:absolute;inset:-20% -10%;background:linear-gradient(115deg,transparent 40%,rgba(255,90,44,.06) 50%,transparent 60%);animation:v3sweep 7s linear infinite}
@keyframes v3sweep{from{transform:translateX(-40%)}to{transform:translateX(40%)}}
.v3-wire{position:absolute;border:1px solid var(--line);border-radius:10px;background:rgba(255,253,248,.5);opacity:.55;animation:v3float 9s ease-in-out infinite}
.v3-wire .wrow{height:8px;border-radius:4px;background:var(--hair);margin:9px 12px}
.v3-wire .wbar{height:22px;border-radius:6px;background:var(--hair);margin:12px}
.v3-wl{left:2.5%;top:120px;width:180px;height:150px;animation-delay:-2s}
.v3-wr{right:2.5%;top:150px;width:190px;height:120px;animation-delay:-5s}
.v3-wr .wcode{font-family:var(--mono);font-size:10.5px;color:var(--fog);margin:12px;line-height:1.7;opacity:.8}
.v3-wr .wcode b{color:var(--orange2);font-weight:400}
@keyframes v3float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.v3-corner{position:absolute;font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--fog);opacity:.6}
.v3-c1{left:22px;top:96px}.v3-c2{right:22px;bottom:24px}
.v3-star{position:absolute;color:var(--orange);opacity:.5;font-size:14px;animation:v3twinkle 3.2s ease-in-out infinite}
.v3-s1{left:16%;top:150px}.v3-s2{right:18%;top:230px;animation-delay:-1.4s}.v3-s3{left:30%;bottom:60px;animation-delay:-2.2s}
@keyframes v3twinkle{0%,100%{opacity:.15;transform:scale(.85)}50%{opacity:.7;transform:scale(1.1)}}
@media(max-width:1080px){.v3-wire,.v3-corner{display:none}}
@media(prefers-reduced-motion:reduce){.v3-shimmer,.v3-wire,.v3-star{animation:none}}
/* two-signature block */
.v3-sigs{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:26px}
.v3-sigcol .v3-sline{border-bottom:1px solid var(--line);padding-bottom:8px;min-height:38px;font-family:var(--serif);font-size:26px}
.v3-sigcol input{border:none;outline:none;background:transparent;font-family:var(--serif);font-size:24px;width:100%;color:var(--ink)}
.v3-sigcol input::placeholder{font-family:var(--sans);font-size:14px;color:var(--fog)}
.v3-sigcol span{display:block;margin-top:8px;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--fog)}
.v3-hirebtn{display:inline-block;margin-top:26px;background:var(--orange);color:#fff;font-weight:700;font-size:15px;padding:14px 26px;border-radius:11px;border:1px solid var(--orange2)}
.v3-pfine{margin-top:14px;font-size:12.5px;color:var(--fog)}
/* section head */
.v3-sec{padding:96px 0}
.v3-sec-head{max-width:720px;margin:0 auto 52px;text-align:center}
.v3-sec-h{margin-top:14px;font-size:clamp(30px,4vw,48px);font-weight:800;letter-spacing:-.03em;line-height:1.04}
.v3-sec-p{margin-top:16px;font-size:18px;color:var(--soft);line-height:1.5}
/* steps */
.v3-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
.v3-step{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:22px 20px 26px}
.v3-step .n{font-family:var(--mono);font-size:12px;color:var(--orange2);letter-spacing:.1em}
.v3-step .t{margin-top:16px;font-size:16px;font-weight:700;line-height:1.25}
/* feature grid */
.v3-feats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.v3-feat{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:28px 26px 30px;transition:.15s}
.v3-feat:hover{border-color:var(--fog);transform:translateY(-2px)}
.v3-feat .fn{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);font-size:12px;color:var(--fog);letter-spacing:.06em}
.v3-feat .fi{font-size:22px}
.v3-feat .ft{margin-top:18px;font-size:20px;font-weight:800;letter-spacing:-.01em}
.v3-feat .fd{margin-top:9px;font-size:14.5px;color:var(--soft);line-height:1.5}
.v3-feat .fd b{color:var(--ink);font-weight:700}
/* scroll reveal (everywhere) */
.rev{opacity:0;transform:translateY(20px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}
.rev.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.rev{opacity:1;transform:none;transition:none}}
/* premium feature section */
.v3-featwrap{position:relative;overflow:hidden;background:var(--bg)}
.v3-featbg{position:absolute;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(var(--hair) 1px,transparent 1px),linear-gradient(90deg,var(--hair) 1px,transparent 1px);background-size:34px 34px;opacity:.55;mask-image:radial-gradient(ellipse 75% 55% at 50% 26%,#000 30%,transparent 80%)}
.v3-featwrap .v3-shell{position:relative;z-index:1}
.v3-feat{position:relative;overflow:hidden;background:var(--white);border:1px solid var(--line);border-radius:18px;padding:28px 26px 30px;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.v3-feat:hover{border-color:#f2c3b3;transform:translateY(-4px);box-shadow:0 18px 40px rgba(255,90,44,.1)}
.v3-ftop{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}
.v3-fi{width:46px;height:46px;border-radius:13px;background:linear-gradient(140deg,#fff,#fff2ec);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--orange2);box-shadow:0 4px 12px rgba(255,90,44,.09);transition:.2s}
.v3-fi svg{width:23px;height:23px}
.v3-feat:hover .v3-fi{background:var(--orange);color:#fff;transform:scale(1.06) rotate(-3deg);box-shadow:0 8px 20px rgba(255,90,44,.35)}
.v3-fnum{font-family:var(--mono);font-size:12px;color:var(--fog);letter-spacing:.06em}
/* animated orbit ("one AI team") */
.v3-orbit{position:relative;width:320px;height:280px;margin:6px auto 40px}
.v3-orbit .ring{position:absolute;border:1px dashed var(--line);border-radius:50%;animation:v3spin 30s linear infinite}
.v3-orbit .ring.a{inset:14px}
.v3-orbit .ring.b{inset:64px;animation-duration:22s;animation-direction:reverse}
.v3-orbit .core{position:absolute;top:50%;left:50%;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:19px;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 14px 36px rgba(255,90,44,.42);z-index:3}
.v3-orbit .chip{position:absolute;background:var(--white);border:1px solid var(--line);border-radius:999px;padding:7px 13px;font-size:12.5px;font-weight:700;box-shadow:0 5px 14px rgba(0,0,0,.07);animation:v3bob 5.5s ease-in-out infinite;z-index:2}
@keyframes v3spin{to{transform:rotate(360deg)}}
@keyframes v3bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
/* step hover life */
.v3-step{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.v3-step:hover{transform:translateY(-4px);border-color:#f2c3b3;box-shadow:0 14px 30px rgba(255,90,44,.09)}
.v3-step:hover .n{color:var(--orange)}
/* why: animated bars + count-up stats */
.v3-why{position:relative;overflow:hidden;background:var(--bg2)}
.v3-bars{max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
.v3-bar-top{display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-bottom:9px}
.v3-bar-top .val{font-family:var(--mono);color:var(--soft);font-weight:400}
.v3-bar-track{height:15px;border-radius:999px;background:#e7e5df;overflow:hidden}
.v3-bar-fill{height:100%;border-radius:999px;width:0;transition:width 1.4s cubic-bezier(.2,.75,.2,1)}
.v3-bar.hot .v3-bar-fill{background:linear-gradient(90deg,var(--orange),#ff8a63);box-shadow:0 0 18px rgba(255,90,44,.4)}
.v3-bar.cold .v3-bar-fill{background:#cbc8c0}
.rev.in .v3-bar-fill{width:var(--w)}
.v3-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:840px;margin:64px auto 0}
.v3-stat{text-align:center}
.v3-stat .big{font-size:clamp(40px,5vw,58px);font-weight:800;letter-spacing:-.03em;line-height:1}
.v3-stat .big .u{color:var(--orange)}
.v3-stat .lab{margin-top:10px;font-size:14.5px;color:var(--soft)}
@media(max-width:760px){.v3-stats{grid-template-columns:1fr;gap:34px}}
/* run: action grid + morning brief */
.v3-run-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.v3-panel{background:var(--white);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 16px 44px rgba(23,21,15,.07);display:flex;flex-direction:column}
.v3-pbar{display:flex;align-items:center;gap:7px;padding:13px 16px;border-bottom:1px solid var(--hair);background:var(--bg2)}
.v3-pbar i{width:9px;height:9px;border-radius:50%;background:#ddd6c6;display:block}
.v3-pbar .u{margin-left:8px;font-family:var(--mono);font-size:12px;color:var(--fog)}
.v3-prompt2{display:flex;align-items:center;justify-content:space-between;margin:16px 16px 4px;padding:12px 14px;border:1px solid var(--line);border-radius:11px;font-size:14.5px;color:var(--soft)}
.v3-prompt2 b{color:var(--ink);font-weight:600}
.v3-prompt2 .go{width:30px;height:30px;border-radius:8px;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px}
.v3-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--hair);margin-top:16px;border-top:1px solid var(--hair)}
.v3-act{background:var(--white);padding:20px 8px;display:flex;flex-direction:column;align-items:center;gap:9px;font-size:12.5px;font-weight:600;color:var(--soft);animation:actpulse 4.8s ease-in-out infinite}
.v3-act svg{width:20px;height:20px;color:var(--fog);transition:.3s}
.v3-act img{height:22px;width:auto}
.v3-channels .v3-act{color:var(--ink);gap:11px}
.v3-channels .v3-act:hover{background:#fff4ef}
@keyframes actpulse{0%,82%,100%{background:var(--white)}9%,18%{background:#fff4ef}}
.v3-act:nth-child(2){animation-delay:.5s}.v3-act:nth-child(3){animation-delay:1s}.v3-act:nth-child(4){animation-delay:1.5s}.v3-act:nth-child(5){animation-delay:2s}.v3-act:nth-child(6){animation-delay:2.5s}.v3-act:nth-child(7){animation-delay:3s}.v3-act:nth-child(8){animation-delay:3.5s}
.v3-brief-tag{display:inline-flex;gap:7px;align-items:center;margin:18px 0 4px 22px;font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--orange2)}
.v3-brief-body{padding:6px 22px 24px;font-size:15.5px;line-height:1.75;color:var(--ink);flex:1}
.v3-cur{display:inline-block;width:8px;height:18px;background:var(--orange);vertical-align:-3px;margin-left:2px;animation:blink 1s step-end infinite}
@keyframes blink{50%{opacity:0}}
/* cursor glow on feature cards */
.v3-feat::after{content:"";position:absolute;inset:0;border-radius:18px;opacity:0;transition:opacity .3s;background:radial-gradient(240px circle at var(--mx,50%) var(--my,50%),rgba(255,90,44,.12),transparent 60%);pointer-events:none;z-index:0}
.v3-feat:hover::after{opacity:1}
.v3-feat>*{position:relative;z-index:1}
/* ascii shimmer band */
.v3-ascii{position:absolute;inset:0;z-index:0;display:flex;align-items:center;justify-content:center;pointer-events:none;overflow:hidden}
.v3-ascii pre{font-family:var(--mono);font-size:11px;line-height:1.3;color:var(--orange);opacity:.12;white-space:pre;margin:0;animation:asciimove 6s ease-in-out infinite;letter-spacing:2px}
@keyframes asciimove{0%,100%{opacity:.07;transform:translateY(5px)}50%{opacity:.16;transform:translateY(-5px)}}
.v3-cta{position:relative;overflow:hidden}
.v3-cta .v3-shell{position:relative;z-index:1}
@media(max-width:760px){.v3-run-grid{grid-template-columns:1fr}}
/* process cards (Plan/Build/Grow) */
.v3-proc{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.v3-pcard{position:relative;background:var(--white);border:1px solid var(--line);border-radius:18px;padding:32px 30px 34px;transition:transform .2s,box-shadow .2s,border-color .2s}
.v3-pcard:hover{transform:translateY(-4px);border-color:#f2c3b3;box-shadow:0 18px 40px rgba(255,90,44,.08)}
.v3-ptop{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}
.v3-pfi{width:52px;height:52px;border-radius:14px;background:linear-gradient(140deg,#fff,#fff2ec);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--orange2);box-shadow:0 6px 16px rgba(255,90,44,.1);transition:.2s}
.v3-pfi svg{width:26px;height:26px}
.v3-pcard:hover .v3-pfi{background:var(--orange);color:#fff;transform:scale(1.06)}
.v3-pnum{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--fog)}
.v3-pt{font-size:26px;font-weight:800;letter-spacing:-.02em}
.v3-pd{margin-top:12px;font-size:15px;line-height:1.62;color:var(--soft)}
.v3-pd b{color:var(--ink);font-weight:700}
@media(max-width:820px){.v3-proc{grid-template-columns:1fr}}
/* story */
.v3-story{background:var(--white);border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.v3-tabs{display:inline-flex;gap:2px;padding:6px;background:var(--bg2);border-radius:999px}
.v3-tab{cursor:pointer;padding:11px 22px;border-radius:999px;font-size:14.5px;font-weight:700;color:var(--soft);border:none;background:transparent;transition:.15s;font-family:var(--sans)}
.v3-tab.on{background:var(--white);color:var(--ink);box-shadow:0 2px 8px rgba(23,21,15,.1)}
.v3-avas{display:flex;justify-content:center;gap:16px;margin-top:26px}
.v3-ava{cursor:pointer;width:58px;height:58px;border-radius:50%;padding:2px;border:2px solid transparent;background:none;transition:.15s;filter:grayscale(.35);opacity:.68}
.v3-ava img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;background:var(--tan)}
.v3-ava.on{border-color:var(--orange);filter:none;opacity:1;transform:translateY(-1px)}
.v3-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:44px}
.v3-card{background:var(--tan);border:1px solid var(--line);border-radius:20px;padding:32px 30px;display:flex;flex-direction:column;min-height:512px}
.v3-beat{align-self:flex-start;background:var(--white);border-radius:10px;padding:8px 16px;font-size:13.5px;font-weight:700;box-shadow:0 1px 3px rgba(23,21,15,.07)}
.v3-line{margin-top:24px;font-size:clamp(23px,2.2vw,29px);font-weight:800;line-height:1.14;letter-spacing:-.015em}
.v3-mock{margin-top:auto;background:var(--white);border-radius:16px;padding:20px;box-shadow:0 10px 26px rgba(23,21,15,.08);min-height:150px;display:flex;flex-direction:column;justify-content:center}
.v3-bq{align-self:center;background:#26221b;color:#fff;border-radius:15px;padding:11px 16px;font-size:14px;line-height:1.3;max-width:96%}
.v3-ba{margin-top:11px;background:var(--bg2);border-radius:13px;padding:11px 16px;font-size:14px;line-height:1.35}
.v3-docbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.v3-dots{display:flex;gap:6px}.v3-dots i{width:9px;height:9px;border-radius:50%;background:#e2dac6;display:block}
.v3-doct{font-size:12.5px;color:var(--soft)}
.v3-skel{height:10px;border-radius:5px;background:#efe8d7;margin:10px 0}
.v3-imgb{height:64px;border-radius:9px;background:linear-gradient(120deg,#e9dfc8,#f2ead7);margin:2px 0 12px;border:1px solid rgba(23,21,15,.05)}
.v3-mlab{font-size:13px;color:var(--soft)}
.v3-mbig{font-size:46px;font-weight:800;line-height:1;color:var(--orange);letter-spacing:-.02em;margin:8px 0 10px}
.v3-mtag{font-size:13.5px;color:var(--soft);line-height:1.4}
.v3-quote{max-width:760px;margin:40px auto 0;text-align:center;font-size:22px;font-weight:600;line-height:1.4}
.v3-by{display:block;margin-top:12px;font-size:14px;color:var(--fog);font-weight:500}
/* agreement */
.v3-hire{background:var(--ink);color:#f4f0e6;padding:104px 0}
.v3-lead{text-align:center;font-size:clamp(30px,4.4vw,52px);font-weight:800;letter-spacing:-.03em;line-height:1.05;margin-bottom:46px}
.v3-lead em{font-style:normal;color:var(--orange)}
.v3-paper{max-width:560px;margin:0 auto;background:var(--white);color:var(--ink);border-radius:14px;padding:38px 40px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.v3-peyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--orange2)}
.v3-ptitle{margin-top:12px;font-size:28px;font-weight:800;letter-spacing:-.02em}
.v3-pdate{font-size:13px;color:var(--fog);margin-bottom:22px}
.v3-prowr{display:flex;justify-content:space-between;padding:11px 0;border-top:1px solid var(--hair);font-size:15px}
.v3-prowr span{color:var(--soft)}.v3-prowr b{font-weight:700}
.v3-pnote{margin-top:20px;font-size:14.5px;color:var(--soft);line-height:1.55}
.v3-pnote b{color:var(--ink)}
.v3-sig{margin-top:26px;font-family:var(--serif);font-size:26px;border-top:1px solid var(--line);padding-top:10px}
.v3-sig span{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--fog)}
/* cta + footer */
.v3-cta{text-align:center;padding:110px 0}
.v3-cta h2{font-size:clamp(34px,5vw,62px);font-weight:800;letter-spacing:-.03em;line-height:1.02}
.v3-cta h2 em{font-style:normal;color:var(--orange)}
.v3-cta p{margin:16px 0 30px;font-size:18px;color:var(--soft)}
.v3-cta .v3-btn{font-size:16px;padding:15px 30px}
.v3-foot{border-top:1px solid var(--hair);padding:30px 0;font-size:13.5px;color:var(--fog);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
@media(max-width:860px){.v3-links{display:none}.v3-prow{flex-wrap:wrap}.v3-go{width:100%}.v3-steps{grid-template-columns:1fr 1fr}.v3-feats{grid-template-columns:1fr}.v3-cards{grid-template-columns:1fr}.v3-card{min-height:0}.v3-hero{padding:52px 0 20px}}
`

const STEPS = [
  'Connect your Shopify store — or start a new one',
  'Selfmade learns your brand, catalog & customers',
  'It builds pages, ads, SEO & creative',
  'You approve every move before it ships',
  'Revenue, ROAS & rankings tracked live',
]

const FEATS = [
  { i: '🛒', t: 'Shopify Website', lead: 'Prompt it into life.', rest: 'A branded storefront with products wired to checkout — no templates, no code.' },
  { i: '📣', t: 'AI Ads', lead: 'Spy, generate, launch.', rest: 'Winning creatives in your brand voice, run on Meta, with budget shifting to what works.' },
  { i: '🔍', t: 'AI SEO & Visibility', lead: 'Rank and get cited.', rest: 'Pages, keywords and schema that climb Google and get you named by ChatGPT.' },
  { i: '🎬', t: 'AI Creative', lead: 'On-brand, on tap.', rest: 'Images and video ads made for you and ready to launch.' },
  { i: '⚡', t: 'CRO & A/B', lead: 'Tests itself, forever.', rest: 'Finds conversion leaks, spins up variants and ships the winners automatically.' },
  { i: '📊', t: 'Live Analytics', lead: 'Know your numbers.', rest: 'True revenue, ROAS and the next move — first-party, all yours.' },
]
const LOGOS: [string, string][] = [['shopify', 'Shopify'], ['aura', 'Aura'], ['ridge', 'Ridge'], ['sevenly', 'Sevenly'], ['spacemen', 'Space Men'], ['plaud', 'Plaud'], ['virginteez', 'Virgin Teez'], ['ejadlabs', 'Ejad Labs']]
const S = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const ICONS = [
  (<svg {...S}><path d="M3 9l1.6-4.5h14.8L21 9M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M4 9h16M9 20v-6h6v6" /></svg>),
  (<svg {...S}><path d="M3 11v2a1 1 0 001 1h2l4 4V6L6 10H4a1 1 0 00-1 1z" /><path d="M15 8s2 1.6 2 4-2 4-2 4" /></svg>),
  (<svg {...S}><circle cx="11" cy="11" r="6" /><path d="M20 20l-3.6-3.6" /></svg>),
  (<svg {...S}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M4 18l5-4 4 3 3.5-2.5L21 18" /></svg>),
  (<svg {...S}><path d="M13 3L5 13h5l-1 8 8-10h-5l1-8z" /></svg>),
  (<svg {...S}><path d="M4 20V11M9.5 20V4M15 20v-6M20.5 20V8M3 20h18" /></svg>),
]
const ORBIT = ['Ads', 'SEO', 'Website', 'Creative', 'CRO', 'Analytics']
const ORBIT_POS = [{ top: '2%', left: '30%' }, { top: '10%', right: '4%' }, { top: '46%', right: '-2%' }, { bottom: '4%', right: '22%' }, { bottom: '8%', left: '10%' }, { top: '40%', left: '-4%' }]
const BRIEF = "Good morning. Overnight I spied 3 competitors, drafted 4 new ad creatives, found 12 buyer-intent keywords, and rewrote 6 product pages. ROAS is up 42%. Everything's ready for your approval."
const CHANNELS: [string, string][] = [['ChatGPT Ads', 'openai'], ['Meta Ads', 'ch-meta'], ['Google Ads', 'ch-google'], ['TikTok Ads', 'ch-tiktok'], ['Instagram', 'ch-instagram'], ['Facebook', 'ch-facebook'], ['X / Twitter', 'ch-x'], ['Pinterest', 'ch-pinterest']]
const PROC = [
  { t: 'Plan', ic: (<svg {...S}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></svg>), lead: 'It finds where the money is.', rest: 'Selfmade studies your store, your customers and your competitors, then pinpoints the fastest wins.' },
  { t: 'Build', ic: (<svg {...S}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><path d="M17 14.5v5M14.5 17h5" /></svg>), lead: 'It makes the work.', rest: 'Ad creatives, SEO pages, product copy and a storefront — all in your brand voice, ready to ship.' },
  { t: 'Grow', ic: (<svg {...S}><path d="M3 17l6-6 4 4 8-8M16 7h5v5" /></svg>), lead: 'It runs and improves.', rest: 'Launches, tracks results, shifts budget to the winners, and reports every win to you already done.' },
]
const ASCII = `::-=+*#%@  ::-=+*#%@  ::-=+*#%@  ::-=+*#%@  ::-=+*#%@
=+*#%@::-=  =+*#%@::-=  =+*#%@::-=  =+*#%@::-=  =+*#%@::-=
#%@::-=+*#  #%@::-=+*#  #%@::-=+*#  #%@::-=+*#  #%@::-=+*#`

const AGREEMENT = [
  ['Employee', 'Mello'], ['Position', 'Your AI marketing company'], ['Working hours', '24/7 — nights included'],
  ['Reports to', 'You'], ['Vacation', 'Never'], ['Notice period', 'None — end it any time'],
  ['Salary', '$49 / month'], ['Starts', 'Tonight'],
]

export default function LandingV3() {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const submitHero = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'existing') {
      const u = q.trim()
      window.location.href = u ? `/store-audit?url=${encodeURIComponent(u)}` : '/store-audit'
    } else {
      window.location.href = '/signup?next=/store-audit'
    }
  }
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('.rev')
    if (!els?.length) return
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return }
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    els.forEach((e) => io.observe(e))
    // count-up numbers
    const nums = rootRef.current?.querySelectorAll<HTMLElement>('.v3-num')
    const nio = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (!e.isIntersecting) return
      const el = e.target as HTMLElement; nio.unobserve(el)
      const to = Number(el.dataset.to || '0'); const dur = 1300; const t0 = performance.now()
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur); el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    }), { threshold: 0.5 })
    nums?.forEach((e) => nio.observe(e))
    // typewriter
    const typers = rootRef.current?.querySelectorAll<HTMLElement>('.v3-type')
    const tio = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (!e.isIntersecting) return
      const el = e.target as HTMLElement; tio.unobserve(el)
      const txt = el.dataset.text || ''; let i = 0
      const step = () => { el.textContent = txt.slice(0, i); i++; if (i <= txt.length) setTimeout(step, 16) }
      step()
    }), { threshold: 0.55 })
    typers?.forEach((e) => tio.observe(e))
    // cursor glow on feature cards
    const feats = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.v3-feat') || [])
    const onMove = (ev: MouseEvent) => { const el = ev.currentTarget as HTMLElement; const r = el.getBoundingClientRect(); el.style.setProperty('--mx', `${ev.clientX - r.left}px`); el.style.setProperty('--my', `${ev.clientY - r.top}px`) }
    feats.forEach((f) => f.addEventListener('mousemove', onMove as EventListener))
    return () => { io.disconnect(); nio.disconnect(); tio.disconnect(); feats.forEach((f) => f.removeEventListener('mousemove', onMove as EventListener)) }
  }, [])
  return (
    <div className="v3" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <a className="v3-ann" href="/store-audit">New · Selfmade now builds &amp; runs your Shopify store — on autopilot →</a>

      <nav className="v3-nav"><div className="v3-shell v3-nav-in">
        <a className="v3-brand" href="/"><span className="v3-spark">✦</span> Selfmade</a>
        <div className="v3-links">
          <div className="v3-drop">
            <button type="button" className="v3-dropbtn">Product <span className="v3-caret">▾</span></button>
            <div className="v3-menu" role="menu">
              <a href="/features/ads"><b>Ad Studio</b><span>Generate, remake &amp; launch ads across Meta, Google &amp; TikTok</span></a>
              <a href="/features/seo"><b>SEO Engine</b><span>Rank on Google with on-brand, AI-written content</span></a>
              <a href="/features/websites"><b>Website Design</b><span>AI builds &amp; restyles your storefront</span></a>
              <a href="/features/ai-visibility"><b>AI Visibility</b><span>Get cited by ChatGPT, Perplexity &amp; Google AI</span></a>
              <a href="/features/shopify"><b>Shopify Autopilot</b><span>50 AI agents run your store, end to end</span></a>
            </div>
          </div>
          <div className="v3-drop">
            <button type="button" className="v3-dropbtn">Solutions <span className="v3-caret">▾</span></button>
            <div className="v3-menu" role="menu">
              <a href="/features/shopify"><b>For Shopify stores</b><span>A full AI growth team for your store</span></a>
              <a href="/features/ads"><b>More sales from ads</b><span>Winning creative, launched &amp; optimized daily</span></a>
              <a href="/features/seo"><b>Rank on Google</b><span>Organic traffic that compounds, hands-off</span></a>
              <a href="/features/ai-visibility"><b>Get found by AI</b><span>Show up when buyers ask ChatGPT</span></a>
            </div>
          </div>
          <a href="/pricing">Pricing</a>
          <a href="/features/websites">Examples</a>
        </div>
        <div className="v3-navr"><a className="v3-login" href="/login">Log in</a><a className="v3-btn" href="/signup">Get started</a></div>
      </div></nav>

      {/* HERO */}
      <header className="v3-hero">
        <div className="v3-bg">
          <div className="v3-grid" />
          <div className="v3-shimmer" />
          <div className="v3-wire v3-wl"><div className="wbar" /><div className="wrow" /><div className="wrow" style={{ width: '60%' }} /><div className="wrow" style={{ width: '82%' }} /></div>
          <div className="v3-wire v3-wr"><div className="wcode">{'{'}<br />&nbsp;&nbsp;<b>&quot;store&quot;</b>: &quot;live&quot;,<br />&nbsp;&nbsp;<b>&quot;ads&quot;</b>: 12,<br />&nbsp;&nbsp;<b>&quot;roas&quot;</b>: &quot;+42%&quot;<br />{'}'}</div></div>
          <span className="v3-corner v3-c1">[ .STORE ]</span>
          <span className="v3-corner v3-c2">[ .ADS ]</span>
          <span className="v3-star v3-s1">✦</span><span className="v3-star v3-s2">✦</span><span className="v3-star v3-s3">✦</span>
        </div>
        <div className="v3-shell v3-hero-in">
          <div className="v3-pill"><span>✦</span> AI-native ecommerce</div>
          <h1 className="v3-h1">World&rsquo;s first <em>AI-native</em><br />ecommerce platform</h1>
          <p className="v3-sub">Selfmade builds your store and runs its ads, SEO, and conversion — then brings every win to you already done. You approve. It ships.</p>
          <form className="v3-prompt" onSubmit={submitHero}>
            <div className="v3-toggle">
              <button type="button" className={'v3-tog' + (mode === 'existing' ? ' on' : '')} onClick={() => setMode('existing')}>Existing store</button>
              <button type="button" className={'v3-tog' + (mode === 'new' ? ' on' : '')} onClick={() => setMode('new')}>New store</button>
            </div>
            <div className="v3-prow">
              <input className="v3-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'existing' ? 'Paste your Shopify store URL…' : 'Tell us what you sell…'} />
              <button className="v3-go" type="submit">{mode === 'existing' ? 'Audit my store →' : 'Build my store →'}</button>
            </div>
          </form>
          <div className="v3-fine"><span><b>For new stores and existing ones</b></span><span>·</span><span>No code needed</span><span>·</span><span>Cancel anytime</span></div>
          <div className="v3-trust">
            <div className="v3-trust-lab">Built for Shopify — trusted by growing brands</div>
            <div className="v3-marquee"><div className="v3-track">
              {[...LOGOS, ...LOGOS].map(([f, a], i) => (
                <img key={i} src={`/logos/${f}.svg`} alt={a} className={f === 'shopify' ? 'v3-mshopify' : ''} />
              ))}
            </div></div>
          </div>
        </div>
      </header>

      {/* STEP LIST */}
      <section className="v3-sec"><div className="v3-shell">
        <div className="v3-sec-head rev"><div className="v3-eye">✦ How it works</div><h2 className="v3-sec-h">Your store on Selfmade</h2><p className="v3-sec-p">Begin free, no code needed. Tell it what you sell — it does the rest and brings each step to you already done.</p></div>
        <div className="v3-steps">
          {STEPS.map((s, i) => (
            <div className="v3-step rev" key={i} style={{ transitionDelay: `${i * 60}ms` }}><div className="n">0{i + 1}</div><div className="t">{s}</div></div>
          ))}
        </div>
      </div></section>

      {/* RUN — channel grid + typing brief */}
      <section className="v3-sec v3-run"><div className="v3-shell">
        <div className="v3-sec-head rev"><div className="v3-eye">✦ How it works</div><h2 className="v3-sec-h">One idea in. Ads on every channel out.</h2><p className="v3-sec-p">Type what you want. Selfmade writes the copy, makes the creative, and launches it across every channel — then optimizes to what works and reports back.</p></div>
        <div className="v3-run-grid">
          <div className="v3-panel rev">
            <div className="v3-pbar"><i /><i /><i /><span className="u">selfmade · new campaign</span></div>
            <a className="v3-prompt2" href="/signup?next=/store-audit"><span><b>Launch ads for my new collection</b></span><span className="go">→</span></a>
            <div className="v3-actions v3-channels">
              {CHANNELS.map(([name, file]) => (<div className="v3-act" key={name}><img src={`/logos/${file}.svg`} alt={name} /><span>{name}</span></div>))}
            </div>
          </div>
          <div className="v3-panel rev" style={{ transitionDelay: '100ms' }}>
            <div className="v3-pbar"><i /><i /><i /><span className="u">morning brief</span></div>
            <div className="v3-brief-tag">✦ Mello · this morning</div>
            <div className="v3-brief-body"><span className="v3-type" data-text={BRIEF} /><span className="v3-cur" /></div>
          </div>
        </div>
      </div></section>

      {/* FEATURE GRID */}
      <section className="v3-sec v3-featwrap">
        <div className="v3-featbg" />
        <div className="v3-shell">
          <div className="v3-sec-head rev"><div className="v3-eye">✦ One AI team</div><h2 className="v3-sec-h">Everything your store needs, in one place</h2><p className="v3-sec-p">Not a pile of apps. One AI team that builds, runs and grows your store — you just approve.</p></div>
          <div className="v3-orbit rev">
            <div className="ring a" /><div className="ring b" />
            <div className="core">✦</div>
            {ORBIT.map((c, i) => (<span className="chip" key={c} style={{ ...ORBIT_POS[i], animationDelay: `-${i * 0.8}s` }}>{c}</span>))}
          </div>
          <div className="v3-feats">
            {FEATS.map((f, i) => (
              <div className="v3-feat rev" key={i} style={{ transitionDelay: `${i * 70}ms` }}>
                <div className="v3-ftop"><span className="v3-fi">{ICONS[i]}</span><span className="v3-fnum">0{i + 1} / 06</span></div>
                <div className="ft">{f.t}</div><div className="fd"><b>{f.lead}</b> {f.rest}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY — animated bars + counters */}
      <section className="v3-sec v3-why"><div className="v3-shell">
        <div className="v3-sec-head rev"><div className="v3-eye">✦ Why it wins</div><h2 className="v3-sec-h">Built to run, not just build</h2><p className="v3-sec-p">Most tools hand you more work. Selfmade does the work and brings you the result.</p></div>
        <div className="v3-bars rev">
          <div className="v3-bar hot"><div className="v3-bar-top"><span>Selfmade</span><span className="val">95% on autopilot</span></div><div className="v3-bar-track"><div className="v3-bar-fill" style={{ ['--w' as any]: '95%' }} /></div></div>
          <div className="v3-bar cold"><div className="v3-bar-top"><span>A stack of point apps</span><span className="val">35%</span></div><div className="v3-bar-track"><div className="v3-bar-fill" style={{ ['--w' as any]: '35%' }} /></div></div>
          <div className="v3-bar cold"><div className="v3-bar-top"><span>Doing it yourself</span><span className="val">10%</span></div><div className="v3-bar-track"><div className="v3-bar-fill" style={{ ['--w' as any]: '10%' }} /></div></div>
        </div>
        <div className="v3-stats">
          <div className="v3-stat rev"><div className="big"><span className="v3-num" data-to="3">0</span><span className="u">M+</span></div><div className="lab">ads studied every night</div></div>
          <div className="v3-stat rev" style={{ transitionDelay: '90ms' }}><div className="big"><span className="v3-num" data-to="12">0</span><span className="u">+</span></div><div className="lab">apps it replaces</div></div>
          <div className="v3-stat rev" style={{ transitionDelay: '180ms' }}><div className="big"><span className="v3-num" data-to="42">0</span><span className="u">%</span></div><div className="lab">avg ROAS lift</div></div>
        </div>
      </div></section>

      {/* PROCESS — Plan / Build / Grow */}
      <section className="v3-story v3-sec"><div className="v3-shell">
        <div className="v3-sec-head rev"><div className="v3-eye">✦ Plan · Build · Grow</div><h2 className="v3-sec-h">From audit to revenue, in three steps</h2><p className="v3-sec-p">Selfmade runs the whole loop for you — you just approve.</p></div>
        <div className="v3-proc">
          {PROC.map((s, i) => (
            <div className="v3-pcard rev" key={s.t} style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="v3-ptop"><div className="v3-pfi">{s.ic}</div><span className="v3-pnum">Step {i + 1}</span></div>
              <div className="v3-pt">{s.t}</div>
              <div className="v3-pd"><b>{s.lead}</b> {s.rest}</div>
            </div>
          ))}
        </div>
      </div></section>

      {/* STATEMENT */}
      <section className="v3-cta"><div className="v3-ascii"><pre>{ASCII}</pre></div><div className="v3-shell rev"><h2>E-commerce, <em>version two.</em></h2><p>Not another app to run. A team that runs it for you.</p></div></section>

      {/* EMPLOYMENT AGREEMENT (kept) */}
      <section className="v3-hire"><div className="v3-shell">
        <div className="v3-lead rev">You&rsquo;re not buying software.<br />You&rsquo;re <em>hiring a company.</em></div>
        <div className="v3-paper rev">
          <div className="v3-peyebrow">Employment agreement · for your signature</div>
          <div className="v3-ptitle">Employment Agreement</div>
          <div className="v3-pdate">Prepared this morning</div>
          {AGREEMENT.map(([k, v]) => (<div className="v3-prowr" key={k}><span>{k}</span><b>{v}</b></div>))}
          <div className="v3-pnote">I will study your market every night and report every morning. Nothing ships without your approval. Let me go at any time, effective immediately, no questions asked. <b>— I only ask for the nights.</b></div>
          <div className="v3-sigs">
            <div className="v3-sigcol"><div className="v3-sline">Mello</div><span>Mello · your marketing manager</span></div>
            <div className="v3-sigcol"><div className="v3-sline"><input placeholder="Type your name to sign" /></div><span>You · Employer</span></div>
          </div>
          <a className="v3-hirebtn" href="/signup">Hire your company →</a>
          <div className="v3-pfine">No card to start · your first brief is free · effective tonight</div>
        </div>
      </div></section>

      {/* FINAL CTA */}
      <section className="v3-cta"><div className="v3-shell rev">
        <h2>Start with the store <em>you already have.</em></h2>
        <p>One URL is enough to get moving.</p>
        <a className="v3-btn" href="/signup">Try Selfmade free →</a>
      </div></section>

      <footer className="v3-foot v3-shell"><span>© 2026 Selfmade, Inc.</span><span>Built for Shopify · E-commerce, version two.</span></footer>
    </div>
  )
}
