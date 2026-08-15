import { useState, useEffect, useRef } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { useSettingsStore } from '../../state/useSettingsStore'
import { Button, Tabs, Slider, Toggle, KeyBindingRow } from '../components/ui'
import styles from './SettingsScreen.module.css'
import type { Action, BindingList } from '../../state/persistence'
import { platform, hasTouch, detectedPointer, resetPointerDetection } from '../../platform/deviceInput'
import { platformName, resolveControls } from '../../platform/controlScheme'

/**
 * `steer` is omitted deliberately: it names the *device* that aims the craft,
 * not a key, and its only value is `'Mouse'`. Offering it in a list of "press a
 * key to rebind" rows would invite the player to bind aiming to a keystroke and
 * then wonder why aiming stopped working. Its actual controls are the
 * sensitivity slider and the invert toggle above the list.
 */
const BINDABLE_ACTIONS: readonly Action[] = [
  'turnLeft', 'turnRight', 'strafeLeft', 'strafeRight',
  'ascend', 'descend', 'boost', 'brake', 'engineCut',
  'fire', 'lock', 'bomb', 'switchWeapon', 'flare', 'map', 'pause', 'recentre',
]

const ACTION_LABELS: Record<Action, string> = {
  steer: 'Steer',
  brake: 'Brake',
  turnLeft: 'Turn Left',
  turnRight: 'Turn Right',
  strafeLeft: 'Slide Left',
  strafeRight: 'Slide Right',
  ascend: 'Climb',
  descend: 'Descend',
  fire: 'Fire',
  lock: 'Missile Lock',
  bomb: 'Drop Heavy Bomb',
  switchWeapon: 'Switch Weapon Mode',
  engineCut: 'Engine Cut / Float',
  flare: 'Flares',
  boost: 'Boost',
  map: 'Orbital Map',
  pause: 'Pause',
  recentre: 'Recentre Aim',
}

export function SettingsScreen() {
  const back = useGameStore(s => s.back)
  const [activeTab, setActiveTab] = useState('Controls')
  // Read once per render rather than subscribed: the detector latches after a
  // handful of wheel events and this screen is not on screen during play.
  const detected = detectedPointer()
  const settings = useSettingsStore(s => s.settings)
  const keybinds = useSettingsStore(s => s.keybinds)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const resetToDefaults = useSettingsStore(s => s.resetToDefaults)
  const setKeybind = useSettingsStore(s => s.setKeybind)
  const clearKeybind = useSettingsStore(s => s.clearKeybind)

  // Focus management and ESC to go back one level
  const containerRef = useRef<HTMLDivElement>(null)

  // Escape is handled once, in `App`, which also guards on `defaultPrevented`
  // so that rebinding an action to Escape does not close this screen on the way
  // past. A local copy of that handler here was one of three racing listeners.
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const renderTab = () => {
    switch (activeTab) {
      case 'Controls':
        return (
          <div className={styles.tabContent}>
            <Toggle
              label="Auto Fire (Touch Default)"
              description="Automatically fire when targets are in range"
              value={settings.controls.autoFire}
              onChange={(v) => updateSettings((s) => ({ ...s, controls: { ...s.controls, autoFire: v } }))}
            />
            <Toggle
              label="Toggle Fire"
              description="Press once to start firing, again to stop"
              value={settings.controls.toggleFire}
              onChange={(v) => updateSettings((s) => ({ ...s, controls: { ...s.controls, toggleFire: v } }))}
            />
            <div className={styles.responseRow}>
              <div className={styles.responseLabel}>
                Pointing Device
                <p className={styles.responseHint}>
                  {settings.controls.pointer === 'auto'
                    ? `Detected automatically${detected === null ? ' — scroll once to sample it' : `: ${detected}`}. A trackpad's throw is a tenth of a mouse's, so the two need different tuning.`
                    : settings.controls.pointer === 'trackpad'
                      ? 'Higher gain and a faster return to centre, for a short-throw surface.'
                      : 'The reference tuning: a firm 750 px/s sweep reaches full deflection.'}
                </p>
              </div>
              <Tabs
                tabs={['auto', 'mouse', 'trackpad']}
                active={settings.controls.pointer}
                onChange={(v) => {
                  resetPointerDetection()
                  updateSettings((s) => ({
                    ...s,
                    controls: { ...s.controls, pointer: v as 'auto' | 'mouse' | 'trackpad' },
                  }))
                }}
              />
            </div>
            <Slider
              label="Pointer Sensitivity"
              value={settings.controls.mouseSensitivity}
              min={10}
              max={300}
              onChange={(v) => updateSettings((s) => ({ ...s, controls: { ...s.controls, mouseSensitivity: v } }))}
            />
            <Toggle
              label="Invert Vertical Aim"
              description="Pull down to raise the nose"
              value={settings.controls.invertY}
              onChange={(v) => updateSettings((s) => ({ ...s, controls: { ...s.controls, invertY: v } }))}
            />
            <Slider
              label="Deadzone"
              value={settings.controls.deadzone}
              min={0}
              max={40}
              onChange={(v) => updateSettings((s) => ({ ...s, controls: { ...s.controls, deadzone: v } }))}
            />
            <div className={styles.responseRow}>
              <div className={styles.responseLabel}>
                Steering Response
                <p className={styles.responseHint}>
                  {settings.controls.steerResponse === 'precise'
                    ? 'Fine control near centre; you have to commit for a hard turn.'
                    : settings.controls.steerResponse === 'sharp'
                      ? 'Bites immediately. Quick to turn, harder to hold a line.'
                      : 'Deflection maps straight to turn rate.'}
                </p>
              </div>
              <Tabs
                tabs={['linear', 'precise', 'sharp']}
                active={settings.controls.steerResponse}
                onChange={(v) =>
                  updateSettings((s) => ({
                    ...s,
                    controls: { ...s.controls, steerResponse: v as 'linear' | 'precise' | 'sharp' },
                  }))
                }
              />
            </div>

            <ControlsCheatSheet keybinds={keybinds} />

            <div className={styles.keybindsList}>
              <p className={styles.keybindsNote}>
                Every control holds two keys and both stay live — that is how WASD and
                the arrows work at the same time. The second slot is optional.
              </p>
              {BINDABLE_ACTIONS.map((action) => (
                <KeyBindingRow
                  key={action}
                  action={ACTION_LABELS[action]}
                  bindings={keybinds[action]}
                  onRebind={(slot, binding) => { setKeybind(action, slot, binding) }}
                  onClear={(slot) => { clearKeybind(action, slot) }}
                />
              ))}
            </div>
          </div>
        )
      case 'Display':
        return (
          <div className={styles.tabContent}>
            <div className={styles.keybindsList}>
              <Toggle
                label="High Quality Graphics"
                description="Disable to reduce draw calls and post-processing"
                value={settings.display.quality === 'high'}
                onChange={(v) => updateSettings((s) => ({ ...s, display: { ...s.display, quality: v ? 'high' : 'low' } }))}
              />
              <Toggle
                label="High Contrast HUD"
                description="Thicker lines, explicit outlines, higher opacity"
                value={settings.display.colorMode === 'high-contrast'}
                onChange={(v) => {
                  updateSettings((s) => ({ ...s, display: { ...s.display, colorMode: v ? 'high-contrast' : 'default' } }))
                  document.documentElement.setAttribute('data-contrast', v ? 'high' : 'default')
                }}
              />
              <Slider
                label="HUD Scale"
                min={75} max={150} value={settings.display.hudScale}
                onChange={(v) => {
                  updateSettings((s) => ({ ...s, display: { ...s.display, hudScale: v } }))
                  document.documentElement.style.setProperty('--hud-scale', String(v / 100))
                }}
              />
            </div>
          </div>
        )
      case 'Audio':
        return (
          <div className={styles.tabContent}>
            <Slider
              label="Master Volume"
              value={settings.audio.master}
              onChange={(v) => updateSettings((s) => ({ ...s, audio: { ...s.audio, master: v } }))}
            />
            <Slider
              label="Sound Effects"
              value={settings.audio.sfx}
              onChange={(v) => updateSettings((s) => ({ ...s, audio: { ...s.audio, sfx: v } }))}
            />
            <Slider
              label="UI & Alerts"
              value={settings.audio.ui}
              onChange={(v) => updateSettings((s) => ({ ...s, audio: { ...s.audio, ui: v } }))}
            />
            <Slider
              label="Music"
              value={settings.audio.music}
              onChange={(v) => updateSettings((s) => ({ ...s, audio: { ...s.audio, music: v } }))}
            />
          </div>
        )
      case 'Accessibility':
        return (
          <div className={styles.tabContent}>
            <Toggle
              label="Reduced Motion"
              description="Replaces camera shake and HUD flashing with static opacity cues"
              value={settings.accessibility.reducedMotion}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, reducedMotion: v } }))}
            />
            <Toggle
              label="Dynamic Difficulty (DDA)"
              description="Auto-adjust spawn intervals based on performance (capped at ±15%)"
              value={settings.accessibility.ddaEnabled}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, ddaEnabled: v } }))}
            />
            <Toggle
              label="Infinite Boost"
              value={settings.accessibility.infiniteBoost}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, infiniteBoost: v } }))}
            />
            <Slider
              label="Aim Assist"
              min={0} max={100} value={settings.accessibility.aimAssist}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, aimAssist: v } }))}
            />
            <Slider
              label="Enemy Damage"
              min={0} max={150} value={settings.accessibility.enemyDamage}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, enemyDamage: v } }))}
            />
            <Slider
              label="Drain Rate"
              min={50} max={150} value={settings.accessibility.drainRate}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, drainRate: v } }))}
            />
            <Slider
              label="Enemy Speed"
              min={75} max={125} value={settings.accessibility.enemySpeed}
              onChange={(v) => updateSettings((s) => ({ ...s, accessibility: { ...s.accessibility, enemySpeed: v } }))}
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className={styles.container} tabIndex={-1} ref={containerRef}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>SETTINGS</h2>
          <Button label="BACK [ESC]" onClick={back} />
        </div>
        
        <Tabs
          tabs={['Controls', 'Display', 'Audio', 'Accessibility']}
          active={activeTab}
          onChange={setActiveTab}
        />
        
        <div className={styles.scrollArea}>
          {renderTab()}
        </div>

        <div className={styles.footer}>
          <Button label="RESET TO DEFAULTS" onClick={resetToDefaults} />
        </div>
      </div>
    </div>
  )
}

/**
 * What the controls actually are, on the device in the player's hands.
 *
 * The keybind list below it answers "what is bound"; this answers "how do I
 * play", and the two are not the same question. It is written per platform
 * because the honest answer differs: a Mac has no Ctrl-click to spare, a
 * touchscreen has no keys at all, and telling a phone player to "hold Shift"
 * is worse than telling them nothing.
 */
function ControlsCheatSheet({ keybinds }: { keybinds: Record<Action, BindingList> }): React.JSX.Element {
  const rows = resolveControls(keybinds)

  return (
    <div className={styles.cheatSheet}>
      <div className={styles.cheatHeader}>
        HOW TO FLY
        <span className={styles.cheatPlatform}>
          {platformName()}
          {hasTouch && platform !== 'touch' ? ' + touch' : ''}
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.id} className={styles.cheatRow}>
          <span className={styles.cheatAction}>{row.label}</span>
          <span className={styles.cheatHow}>
            <strong className={styles.cheatKeys}>{row.keys}</strong>
            {row.note !== undefined && <span className={styles.cheatNote}>{row.note}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
