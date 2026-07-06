/**
 * Permissive CORS for the extension API surface. These routes are Bearer-token authed and set NO
 * cookies, so `*` origin is safe (a stolen response is useless without the token). Lets the
 * extension call from a content-script/page context (background-script calls don't need it, but
 * belt-and-suspenders). Every extension route exports OPTIONS = preflight and wraps its JSON in
 * withCors().
 */
import { NextResponse } from 'next/server'

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
  return res
}

export function corsJson(body: unknown, init?: { status?: number }): NextResponse {
  return withCors(NextResponse.json(body, init))
}

export function preflight(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }))
}
