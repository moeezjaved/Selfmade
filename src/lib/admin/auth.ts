import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

export function getAdminToken(): string {
  const password = process.env.ADMIN_PASSWORD || ''
  const salt = process.env.ADMIN_SECRET_SALT || 'selfmade-admin-2024'
  return createHmac('sha256', salt).update(password).digest('hex')
}

export function verifyAdminRequest(request: NextRequest): boolean {
  if (!process.env.ADMIN_PASSWORD) return false
  const cookie = request.cookies.get('admin_token')?.value
  return cookie === getAdminToken()
}
