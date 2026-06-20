/** Starter automation templates surfaced in the Automations UI (the 3 from the spec). */
export const AUTOMATION_TEMPLATES = [
  { name: 'Weekly Performance Analysis', schedule_cron: '0 9 * * 1', schedule_label: 'Weekly · Mondays 9am',
    prompt: "Review last week's ad performance for my primary account. Summarize spend, ROAS, top and bottom ads, and the 3 most important actions to take this week." },
  { name: 'Weekly Competitor Insights', schedule_cron: '0 9 * * 1', schedule_label: 'Weekly · Mondays 9am',
    prompt: 'Track competitor moves in my niche this week — new messaging angles, offers, and creative patterns from the ad library — and what I should respond to.' },
  { name: 'Daily Market Inspirations', schedule_cron: '0 8 * * *', schedule_label: 'Daily · 8am',
    prompt: 'Find fresh market trends and creative ideas in my category today from the ad library. Give me 3 concrete creative ideas I can act on.' },
]
