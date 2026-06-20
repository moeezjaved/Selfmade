import { NextRequest, NextResponse } from 'next/server'
import { PROMPT_LIBRARY, PROMPT_CATEGORIES } from '@/lib/mello/prompts'

export const dynamic = 'force-dynamic'

// GET /api/mello/prompts?category=&q=
export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category')
  const q = (request.nextUrl.searchParams.get('q') || '').toLowerCase().trim()

  let items = PROMPT_LIBRARY
  if (category) items = items.filter(p => p.category === category)
  if (q) items = items.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.prompt.toLowerCase().includes(q)
  )

  return NextResponse.json({ categories: PROMPT_CATEGORIES, prompts: items })
}
