/**
 * True when a Supabase/PostgREST error is just "this table doesn't exist yet" — i.e. the migration
 * hasn't been applied. Lets new features deploy ahead of their migration and degrade to an empty
 * state instead of 500ing. (Postgres undefined_table = 42P01; PostgREST schema-cache miss = PGRST205.)
 */
export function isMissingTable(err: any): boolean {
  if (!err) return false
  const code = err.code || ''
  if (code === '42P01' || code === 'PGRST205') return true
  const msg = String(err.message || '')
  return /does not exist|could not find the table|schema cache/i.test(msg)
}
