/**
 * Drizzle ORM schema (gameplan §39, TASK-5 §3–§5).
 *
 * Five tables:
 *  - accounts       — one row per player
 *  - credentials    — WebAuthn passkey credentials (many per account)
 *  - magic_links    — single-use email tokens (many per account, short-lived)
 *  - saves          — one active save per account, versioned
 *  - leaderboard    — verified top scores, with inputLog for accepted top entries
 *
 * Parameterised queries only (Drizzle gives this by default).
 * No raw SQL anywhere in this file.
 */
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'

/* ------------------------------------------------------------------ */
/* accounts                                                             */
/* ------------------------------------------------------------------ */

export const accounts = pgTable('accounts', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  displayName: varchar('display_name', { length: 32 }).notNull(),
  /** Null for passkey-only players — the one PII field in the system. */
  email:       varchar('email', { length: 256 }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * Soft-delete: row stays for FK integrity, display name is nulled in the
   * leaderboard, and the GDPR export endpoint returns nothing after deletion.
   */
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
})

/* ------------------------------------------------------------------ */
/* credentials (WebAuthn)                                               */
/* ------------------------------------------------------------------ */

export const credentials = pgTable('credentials', {
  id:              bigserial('id', { mode: 'number' }).primaryKey(),
  accountId:       bigserial('account_id', { mode: 'number' }).notNull().references(() => accounts.id),
  credentialId:    text('credential_id').notNull().unique(),
  publicKey:       text('public_key').notNull(),   // base64url-encoded COSE key
  counter:         integer('counter').notNull().default(0),
  /** e.g. 'cross-platform', 'platform' */
  transports:      text('transports').array(),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt:      timestamp('last_used_at', { withTimezone: true }),
})

/* ------------------------------------------------------------------ */
/* magic_links                                                          */
/* ------------------------------------------------------------------ */

export const magicLinks = pgTable('magic_links', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: bigserial('account_id', { mode: 'number' }).references(() => accounts.id),
  /** Unverified email address — account row only created on click. */
  email:     varchar('email', { length: 256 }).notNull(),
  /** SHA-256 of the actual token sent in the email. Never store the plaintext. */
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  used:      boolean('used').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ------------------------------------------------------------------ */
/* saves                                                                */
/* ------------------------------------------------------------------ */

export const saves = pgTable('saves', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: bigserial('account_id', { mode: 'number' }).notNull().references(() => accounts.id).unique(),
  /**
   * Monotonic integer. The client sends its baseRevision; if the stored
   * revision is higher, return 409 with both versions rather than silently
   * overwriting a session the player played elsewhere.
   */
  revision:  integer('revision').notNull().default(0),
  savedAt:   timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  /** Full PersistedData blob, validated by the server before storage. */
  blob:      jsonb('blob').notNull(),
})

/* ------------------------------------------------------------------ */
/* leaderboard                                                          */
/* ------------------------------------------------------------------ */

export const leaderboard = pgTable(
  'leaderboard',
  {
    id:                bigserial('id', { mode: 'number' }).primaryKey(),
    accountId:         bigserial('account_id', { mode: 'number' }).notNull().references(() => accounts.id),
    worldId:           varchar('world_id', { length: 64 }).notNull(),
    endless:           boolean('endless').notNull().default(false),
    score:             integer('score').notNull(),
    wave:              integer('wave').notNull(),
    outpostsRemaining: integer('outposts_remaining').notNull(),
    seed:              varchar('seed', { length: 64 }).notNull(),
    simVersion:        integer('sim_version').notNull(),
    /**
     * Packed base64 input log — stored only for accepted top-N entries so
     * any score can be re-verified after a bug fix, and any entry can
     * eventually be watched as a ghost replay (§5.3).
     */
    inputLog:          text('input_log'),
    verifiedAt:        timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One verified entry per account per world (upsert on improvement). */
    accountWorldUnique: unique().on(t.accountId, t.worldId, t.endless),
  }),
)

/* ------------------------------------------------------------------ */
/* Shared type helpers                                                  */
/* ------------------------------------------------------------------ */

export type Account    = typeof accounts.$inferSelect
export type Credential = typeof credentials.$inferSelect
export type Save       = typeof saves.$inferSelect
export type LeaderboardEntry = typeof leaderboard.$inferSelect
