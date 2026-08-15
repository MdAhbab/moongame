import { useState } from 'react'
import WorldBackdrop from '../game/WorldBackdrop'
import { Tabs, Slider, Toggle, KeyBindingRow, Button } from '../game/ui'

const TABS = ['Controls', 'Display', 'Audio', 'Accessibility']

export default function SettingsScreen({ onBack }: { onBack?: () => void }) {
  const [tab, setTab] = useState('Accessibility')
  const [hudScale, setHudScale] = useState(100)
  const [aimAssist, setAimAssist] = useState(60)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [adaptive, setAdaptive] = useState(true)
  const [master, setMaster] = useState(80)
  const [music, setMusic] = useState(55)
  const [sfx, setSfx] = useState(75)
  const [highContrast, setHighContrast] = useState(false)
  const [quality, setQuality] = useState('Auto')

  return (
    <div className="relative h-full w-full overflow-auto">
      <WorldBackdrop dimmed />
      <div className="relative mx-auto min-h-full max-w-2xl px-8 py-14">
        <h2 className="font-hud text-[32px] font-semibold" style={{ letterSpacing: '-0.01em' }}>Settings</h2>
        <div className="mt-6">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        <div className="mt-8 flex flex-col gap-6">
          {tab === 'Controls' && (
            <>
              <p className="text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>Keyboard &amp; mouse. Click a binding to remap; conflicts are flagged inline.</p>
              {[
                ['Throttle Up', 'W'], ['Throttle Down', 'S'], ['Roll Left', 'A'], ['Roll Right', 'D'],
                ['Climb', 'SPACE'], ['Descend', 'CTRL'], ['Fire', 'LMB'], ['Lock Missile', 'RMB'],
                ['Boost', 'SHIFT'], ['Orbital Map', 'TAB'], ['Pause', 'ESC'],
              ].map(([a, k]) => <KeyBindingRow key={a} action={a} keyLabel={k} />)}
              <div className="mt-1 flex items-center gap-2 text-[14px]" style={{ color: 'var(--color-caution)' }}>
                <span className="h-2 w-2 rotate-45" style={{ background: 'var(--color-caution)' }} /> No conflicts detected. Gamepad &amp; touch schemes shown on their own devices.
              </div>
            </>
          )}

          {tab === 'Display' && (
            <>
              <div>
                <div className="hud-label mb-2">Quality Tier</div>
                <div className="flex gap-2">
                  {['Auto', 'High', 'Medium', 'Low'].map((q) => (
                    <button key={q} onClick={() => setQuality(q)}
                      className="flex-1 py-2 font-hud text-[14px] font-medium"
                      style={{ border: `1px solid ${quality === q ? 'var(--color-friendly)' : 'rgba(139,151,166,0.3)'}`, color: quality === q ? 'var(--color-friendly)' : 'var(--color-text-primary)', background: quality === q ? 'rgba(127,232,255,0.1)' : 'transparent', borderRadius: 2 }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <Slider label="HUD Scale" value={hudScale} min={75} max={150} onChange={setHudScale} />
              <Toggle label="High Contrast" description="Boosts stroke weights and text scrims for maximum legibility." value={highContrast} onChange={setHighContrast} />
              <Toggle label="FPS Counter" value={false} />
            </>
          )}

          {tab === 'Audio' && (
            <>
              <p className="text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>The game is fully playable muted — every cue also has a visual channel.</p>
              <Slider label="Master" value={master} onChange={setMaster} />
              <Slider label="Music" value={music} onChange={setMusic} />
              <Slider label="SFX" value={sfx} onChange={setSfx} />
            </>
          )}

          {tab === 'Accessibility' && (
            <>
              <p className="text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>
                These are ordinary options, not a reduced mode. Tune the game to how you want to play it.
              </p>
              <Toggle label="Reduced Motion" description="Replaces pulses and sweeps with steady state changes that carry the same information." value={reducedMotion} onChange={setReducedMotion} />
              <Slider label="Aim Assist" value={aimAssist} onChange={setAimAssist} />
              <Slider label="Enemy Damage" value={100} onChange={() => {}} />
              <Slider label="Drain Rate" value={100} onChange={() => {}} />
              <Slider label="Enemy Speed" value={100} onChange={() => {}} />
              <Toggle label="Infinite Boost" value={false} />
              <Toggle
                label="Adaptive Difficulty"
                description="On: the game quietly adjusts difficulty by up to 15% based on how you're doing — easing off after a rough patch, pressing harder when you're comfortable. We tell you this rather than hide it. Off: every run plays exactly as authored."
                value={adaptive}
                onChange={setAdaptive}
              />
            </>
          )}
        </div>

        <div className="mt-10 flex justify-end gap-3">
          <Button label="RESET TO DEFAULTS" />
          <Button label="DONE" primary onClick={onBack} />
        </div>
      </div>
    </div>
  )
}
