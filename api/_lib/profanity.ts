/**
 * Profanity filter for display names (TASK-5 §7).
 *
 * Display names are user content: length-capped, rendered as text and never as
 * HTML, profanity-filtered at submission, and reportable (§7).
 *
 * Uses `bad-words` as a lightweight local denylist. This is not a complete
 * content moderation solution — report functionality and a moderation queue
 * are the upgrade path.
 */
import { Filter as BadWordsFilter } from 'bad-words'

const filter = new BadWordsFilter()

/** Returns true if the name is clean and within length bounds. */
export function isCleanDisplayName(name: string): boolean {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 32) return false
  try {
    return !filter.isProfane(trimmed)
  } catch {
    // isProfane can throw on some edge-case inputs; treat as clean.
    return true
  }
}

/** Returns the name sanitised and trimmed. Does not mutate the argument. */
export function sanitiseDisplayName(name: string): string {
  return name.trim().slice(0, 32)
}
