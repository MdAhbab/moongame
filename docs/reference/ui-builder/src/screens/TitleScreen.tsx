import WorldBackdrop from '../game/WorldBackdrop'

function MenuItem({ label, primary, sub, onClick }: { label: string; primary?: boolean; sub?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-baseline justify-between px-5 py-3 text-left transition-[background,transform] duration-200"
      style={{
        border: `1px solid ${primary ? 'var(--color-friendly)' : 'rgba(139,151,166,0.28)'}`,
        background: primary ? 'rgba(127,232,255,0.12)' : 'transparent',
        borderRadius: 2,
      }}
    >
      <span className="font-hud text-[18px] font-semibold tracking-wide"
        style={{ color: primary ? 'var(--color-friendly)' : 'var(--color-text-primary)', letterSpacing: '0.06em' }}>
        {label}
      </span>
      {sub && <span className="hud-label">{sub}</span>}
    </button>
  )
}

export default function TitleScreen({
  returning = true,
  onPlay,
  onTutorial,
  onSettings,
  onCredits,
  best,
}: {
  returning?: boolean
  onPlay?: () => void
  onTutorial?: () => void
  onSettings?: () => void
  onCredits?: () => void
  best?: number
}) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <WorldBackdrop />
      <div className="absolute inset-0 text-scrim" />

      <div className="absolute inset-0 flex flex-col justify-between p-[6%]">
        <header>
          <h1 className="font-hud font-bold leading-[0.92]" style={{ fontSize: 64, letterSpacing: '-0.02em' }}>
            MARE<br />NOCTIS
          </h1>
          <p className="mt-3 max-w-xs text-[16px]" style={{ color: 'var(--color-text-secondary)' }}>
            One pilot. Eight fragile outposts. You will not save them all.
          </p>
        </header>

        <div className="flex items-end justify-between gap-8">
          <nav className="flex w-[300px] flex-col gap-2">
            <MenuItem label="PLAY" primary={returning} onClick={onPlay} />
            <MenuItem label="TUTORIAL" primary={!returning} sub={returning ? undefined : 'START HERE'} onClick={onTutorial} />
            <MenuItem label="SETTINGS" onClick={onSettings} />
            <MenuItem label="CREDITS" onClick={onCredits} />
          </nav>

          <div className="pb-1 text-right">
            <div className="hud-label">Personal Best</div>
            {returning ? (
              <div className="font-hud text-[22px] font-bold tabular-nums">{(best ?? 48920).toLocaleString()}</div>
            ) : (
              <div className="font-hud text-[15px] font-semibold" style={{ color: 'var(--color-caution)' }}>
                NO RECORD YET — PLAY YOUR FIRST RUN
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
