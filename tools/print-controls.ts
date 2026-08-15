/**
 * Regenerates `docs/CONTROLS.md` from `src/platform/controlScheme.ts`.
 *
 *     npx tsx tools/print-controls.ts > docs/CONTROLS.md
 *
 * The document is generated rather than written because a hand-maintained
 * control reference is a document that is wrong. `docs/gameplan.md` §8 carried
 * an incorrect table for months — it listed a roll axis the simulation does not
 * have and a throttle key whose only effect was to undo the brake — and nobody
 * noticed, because nothing checked it against the code.
 *
 * Prints every platform's bindings, not just the current one, so the file is the
 * same on whichever machine regenerates it.
 */
import { CONTROL_ROWS } from '../src/platform/controlScheme.ts'
import { defaultKeybinds } from '../src/state/persistence.ts'
import { codeLabel, type Platform } from '../src/platform/keys.ts'

const PLATFORMS: Platform[] = ['windows', 'macos', 'linux']
const binds = defaultKeybinds()

const lines: string[] = []
lines.push('# Controls')
lines.push('')
lines.push('> **Generated** by `tools/print-controls.ts` from')
lines.push('> `src/platform/controlScheme.ts`. Do not edit by hand — a control')
lines.push('> reference maintained separately from the code is a control reference')
lines.push('> that is wrong, and this one was, for months.')
lines.push('')
lines.push('These are the **defaults**. Every action holds up to two bindings and')
lines.push('both are live at once, which is why WASD and the arrow keys work')
lines.push('together rather than being a choice. All of it is rebindable in')
lines.push('Settings → Controls.')
lines.push('')

for (const platform of PLATFORMS) {
  const name = platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : 'Linux'
  lines.push(`## ${name}`)
  lines.push('')
  lines.push('| Action | Keys | Notes |')
  lines.push('|---|---|---|')
  for (const row of CONTROL_ROWS) {
    const keys = row.actions
      .map((action) => binds[action].map((b) => codeLabel(b, platform)).join(' / '))
      .join(' · ')
    lines.push(`| ${row.label} | \`${keys}\` | ${row.note ?? ''} |`)
  }
  lines.push('')
}

lines.push('## Touch')
lines.push('')
lines.push('| Action | Gesture |')
lines.push('|---|---|')
for (const row of CONTROL_ROWS) {
  if (row.touch === undefined) continue
  lines.push(`| ${row.label} | ${row.touch} |`)
}
lines.push('')
lines.push('Every widget owns its own pointer, so steering, throttle and firing')
lines.push('are three fingers rather than three turns. Tap a hostile marker on the')
lines.push('Threat Ring to lock that specific target.')
lines.push('')

lines.push('## Gamepad')
lines.push('')
lines.push('| Action | Control |')
lines.push('|---|---|')
lines.push('| Turn / aim | Left stick |')
lines.push('| Slide / climb | Right stick |')
lines.push('| Throttle | Right trigger |')
lines.push('| Fire | A / Cross, or right trigger |')
lines.push('| Missile lock | B / Circle, or left trigger |')
lines.push('| Boost | Left stick click, or X / Square |')
lines.push('| Heavy bomb bay | Y / Triangle |')
lines.push('| Weapon mode | Left bumper |')
lines.push('| Countermeasure flares | Right bumper |')
lines.push('| Engine cut / drift | Right stick click |')
lines.push('| Pause | Start |')
lines.push('')
lines.push('The two stick families mirror the keyboard split: the left stick')
lines.push('changes where the nose points, the right stick moves the craft without')
lines.push('turning it.')
lines.push('')

lines.push('## Why the modifier differs by platform')
lines.push('')
lines.push('`Ctrl+W` closes the tab on Windows and Linux, and no web page can')
lines.push('intercept it — binding "climb" there would ship a control that quits')
lines.push('the game. On macOS that shortcut is `⌘W`, leaving `⌃W` free. The arrow')
lines.push('keys are the modifier-free path on every platform, so nobody is ever')
lines.push('dependent on a chord.')
lines.push('')
lines.push('Settings refuses to bind a chord the browser owns, and says which one')
lines.push('and why.')
lines.push('')

process.stdout.write(lines.join('\n'))
