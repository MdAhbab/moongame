/**
 * Drizzle + Neon Postgres client singleton.
 *
 * Imported by every API function that needs the database.
 * The `neon` driver works in both Edge Functions and Node (Vercel Functions).
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.ts'

const sql = neon(process.env['DATABASE_URL'] ?? '')
export const db = drizzle(sql, { schema })

export type { Account, Credential, Save, LeaderboardEntry } from './schema.ts'
