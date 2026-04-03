/**
 * Returns true when a Supabase/PostgREST error means the table doesn't exist yet.
 * Handles both the raw PostgreSQL code (42P01) and the PostgREST schema-cache message.
 */
export function isTableMissing(error: { code?: string; message?: string }): boolean {
  if (error.code === '42P01') return true
  if (error.message?.includes('schema cache')) return true
  if (error.message?.includes('does not exist')) return true
  return false
}
