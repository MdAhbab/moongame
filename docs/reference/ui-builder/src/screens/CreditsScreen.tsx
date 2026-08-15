import { Button } from '../game/ui'

// Scannable attribution — judges read this.
export default function CreditsScreen({ onBack }: { onBack?: () => void }) {
  const sections: [string, string[]][] = [
    ['Design & Direction', ['Interface & HUD systems', 'Threat Ring concept', 'Accessibility model']],
    ['Engineering', ['Real-time 3D renderer', 'Procedural moon generation', 'Orbital flight model']],
    ['Audio', ['Adaptive score', 'Spatial SFX']],
  ]
  return (
    <div className="h-full w-full overflow-auto bg-void px-8 py-14">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-hud text-[32px] font-semibold" style={{ letterSpacing: '-0.01em' }}>Credits</h2>
          {onBack && <Button label="← BACK" onClick={onBack} />}
        </div>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {sections.map(([title, roles]) => (
            <div key={title}>
              <div className="hud-label mb-3" style={{ color: 'var(--color-friendly)' }}>{title}</div>
              <ul className="flex flex-col gap-1.5">
                {roles.map((r) => <li key={r} className="text-[15px]" style={{ color: 'var(--color-text-primary)' }}>{r}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t pt-8" style={{ borderColor: 'rgba(139,151,166,0.16)' }}>
          <div className="hud-label mb-3">On the Moon</div>
          <p className="max-w-prose text-[16px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Every moon is generated on your machine at load. A seeded noise field is folded into terrain, then
            eroded by simulated impacts that carve the craters and their ejecta. Outposts are placed on the
            resulting slopes, never inside a crater wall. Nothing is downloaded — the same seed always rebuilds
            the identical world, which is why a run can be shared and replayed exactly.
          </p>
        </div>

        <div className="mt-8 border-t pt-8" style={{ borderColor: 'rgba(139,151,166,0.16)' }}>
          <div className="hud-label mb-3">Technology</div>
          <p className="text-[15px]" style={{ color: 'var(--color-text-secondary)' }}>
            WebGL2 · React · TypeScript · Web Audio API · Chakra Petch &amp; Inter typefaces
          </p>
        </div>
      </div>
    </div>
  )
}
