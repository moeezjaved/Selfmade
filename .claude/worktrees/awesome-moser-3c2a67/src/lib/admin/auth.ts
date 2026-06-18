import { NextRequest } from 'next/server'

export function verifyAdminRequest(request: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  return request.cookies.get('admin_token')?.value === token
}
