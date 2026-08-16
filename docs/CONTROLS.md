# Controls

> **Generated** by `tools/print-controls.ts` from
> `src/platform/controlScheme.ts`. Do not edit by hand — a control
> reference maintained separately from the code is a control reference
> that is wrong, and this one was, for months.

These are the **defaults**. Every action holds up to two bindings and
both are live at once, which is why WASD and the arrow keys work
together rather than being a choice. All of it is rebindable in
Settings → Controls.

## Windows

| Action | Keys | Notes |
|---|---|---|
| Shoot | `Space / LMB` | Hold it. The gun has heat rather than ammunition, so it never runs out — it stops. |
| Turn | `← · →` | Or move the mouse. Turning changes where the nose points. |
| Slide | `A / Ctrl+← · D / Ctrl+→` | Translation without turning — the way to break a firing solution without giving up your heading. |
| Climb / dive | `↑ · ↓` |  |
| Boost | `W / Ctrl+↑` | 3 seconds, then 6 to recharge. Spend it on the leg that changes the outcome. |
| Brake | `S / Ctrl+↓` | The craft holds cruise by itself, so this is the only throttle control there is. |
| Weapon mode | `Q / Tab` | Pulse cannon or guided missiles. The mode is named under the crosshair, always. |
| Missile lock | `Shift / RMB` | Hold it on a target until the ring closes. The lock then keeps itself for four seconds — let go, fly, and fire when you are ready. |
| Heavy bomb bay | `V / B` | The ring on the ground is where it will land, drawn at its true blast radius. A bomb keeps your speed, so it lands well ahead of you. |
| Engine Cut / Newtonian Drift | `C` | Cut propulsion and coast on momentum, turning freely. Press again — or boost — to relight. |
| Countermeasure flares | `X` | Burns every hostile round within 40 u. Five per run — the answer to being cornered, not to being shot at. |
| Launch escort drones | `H` | They fly your wing for 20 s and shoot on their own. Bring them home alive and the next launch is bigger — lose one and you start again at a single drone. |
| Orbital map | `M` | Held, not toggled. The rings are seconds of flight at cruise. |
| Recentre aim | `R` |  |
| Pause | `Esc / P` |  |

## macOS

| Action | Keys | Notes |
|---|---|---|
| Shoot | `Space / LMB` | Hold it. The gun has heat rather than ammunition, so it never runs out — it stops. |
| Turn | `← · →` | Or move the mouse. Turning changes where the nose points. |
| Slide | `A / ⌃← · D / ⌃→` | Translation without turning — the way to break a firing solution without giving up your heading. |
| Climb / dive | `↑ · ↓` |  |
| Boost | `W / ⌃↑` | 3 seconds, then 6 to recharge. Spend it on the leg that changes the outcome. |
| Brake | `S / ⌃↓` | The craft holds cruise by itself, so this is the only throttle control there is. |
| Weapon mode | `Q / Tab` | Pulse cannon or guided missiles. The mode is named under the crosshair, always. |
| Missile lock | `⇧ / RMB` | Hold it on a target until the ring closes. The lock then keeps itself for four seconds — let go, fly, and fire when you are ready. |
| Heavy bomb bay | `V / B` | The ring on the ground is where it will land, drawn at its true blast radius. A bomb keeps your speed, so it lands well ahead of you. |
| Engine Cut / Newtonian Drift | `C` | Cut propulsion and coast on momentum, turning freely. Press again — or boost — to relight. |
| Countermeasure flares | `X` | Burns every hostile round within 40 u. Five per run — the answer to being cornered, not to being shot at. |
| Launch escort drones | `H` | They fly your wing for 20 s and shoot on their own. Bring them home alive and the next launch is bigger — lose one and you start again at a single drone. |
| Orbital map | `M` | Held, not toggled. The rings are seconds of flight at cruise. |
| Recentre aim | `R` |  |
| Pause | `Esc / P` |  |

## Linux

| Action | Keys | Notes |
|---|---|---|
| Shoot | `Space / LMB` | Hold it. The gun has heat rather than ammunition, so it never runs out — it stops. |
| Turn | `← · →` | Or move the mouse. Turning changes where the nose points. |
| Slide | `A / Ctrl+← · D / Ctrl+→` | Translation without turning — the way to break a firing solution without giving up your heading. |
| Climb / dive | `↑ · ↓` |  |
| Boost | `W / Ctrl+↑` | 3 seconds, then 6 to recharge. Spend it on the leg that changes the outcome. |
| Brake | `S / Ctrl+↓` | The craft holds cruise by itself, so this is the only throttle control there is. |
| Weapon mode | `Q / Tab` | Pulse cannon or guided missiles. The mode is named under the crosshair, always. |
| Missile lock | `Shift / RMB` | Hold it on a target until the ring closes. The lock then keeps itself for four seconds — let go, fly, and fire when you are ready. |
| Heavy bomb bay | `V / B` | The ring on the ground is where it will land, drawn at its true blast radius. A bomb keeps your speed, so it lands well ahead of you. |
| Engine Cut / Newtonian Drift | `C` | Cut propulsion and coast on momentum, turning freely. Press again — or boost — to relight. |
| Countermeasure flares | `X` | Burns every hostile round within 40 u. Five per run — the answer to being cornered, not to being shot at. |
| Launch escort drones | `H` | They fly your wing for 20 s and shoot on their own. Bring them home alive and the next launch is bigger — lose one and you start again at a single drone. |
| Orbital map | `M` | Held, not toggled. The rings are seconds of flight at cruise. |
| Recentre aim | `R` |  |
| Pause | `Esc / P` |  |

## Touch

| Action | Gesture |
|---|---|
| Shoot | ◉ button |
| Turn | drag left side |
| Climb / dive | drag up / down |
| Boost | ⏵⏵ button |
| Brake | drag THR down |
| Weapon mode | ⇋ WPN button |
| Missile lock | ⌖ button, or Auto Lock in Settings |
| Heavy bomb bay | 💣 button |
| Engine Cut / Newtonian Drift | ◇ DRIFT button |
| Countermeasure flares | ◈ button |
| Launch escort drones | 🛰 button |
| Pause | ❚❚ button |

Every widget owns its own pointer, so steering, throttle and firing
are three fingers rather than three turns. Tap a hostile marker on the
Threat Ring to lock that specific target.

## Gamepad

| Action | Control |
|---|---|
| Turn / aim | Left stick |
| Slide / climb | Right stick |
| Throttle | Right trigger |
| Fire | A / Cross, or right trigger |
| Missile lock | B / Circle, or left trigger |
| Boost | Left stick click, or X / Square |
| Heavy bomb bay | Y / Triangle |
| Weapon mode | Left bumper |
| Countermeasure flares | Right bumper |
| Engine cut / drift | Right stick click |
| Pause | Start |

The two stick families mirror the keyboard split: the left stick
changes where the nose points, the right stick moves the craft without
turning it.

## Why the modifier differs by platform

`Ctrl+W` closes the tab on Windows and Linux, and no web page can
intercept it — binding "climb" there would ship a control that quits
the game. On macOS that shortcut is `⌘W`, leaving `⌃W` free. The arrow
keys are the modifier-free path on every platform, so nobody is ever
dependent on a chord.

Settings refuses to bind a chord the browser owns, and says which one
and why.
