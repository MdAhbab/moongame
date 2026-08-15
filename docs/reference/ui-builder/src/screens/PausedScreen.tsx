import WorldBackdrop from '../game/WorldBackdrop'
import { Button } from '../game/ui'

// A genuine stop — calm, quiet, tension visibly suspended.
export default function PausedScreen({
  wave = 5,
  score = 12480,
  onResume,
  onSettings,
  onRestart,
  onQuit,
}: {
  wave?: number
  score?: number
  onResume?: () => void
  onSettings?: () => void
  onRestart?: () => void
  onQuit?: () => void
}) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <WorldBackdrop dimmed />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="enter-overshoot w-[320px] p-8" style={{ border: '1px solid rgba(139,151,166,0.22)', background: 'rgba(21,27,36,0.85)', backdropFilter: 'blur(4px)', borderRadius: 2 }}>
          <div className="flex items-baseline justify-between">
            <h2 className="font-hud text-[24px] font-semibold tracking-widest">PAUSED</h2>
            <span className="hud-label">Esc resumes</span>
          </div>
          <div className="mt-2 flex gap-6">
            <div><span className="hud-label">Wave</span><div className="font-hud text-[18px] font-bold tabular-nums">{wave}</div></div>
            <div><span className="hud-label">Score</span><div className="font-hud text-[18px] font-bold tabular-nums">{score.toLocaleString()}</div></div>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Button label="RESUME" primary full onClick={onResume} />
            <Button label="SETTINGS" full onClick={onSettings} />
            <Button label="RESTART WAVE" full onClick={onRestart} />
            <Button label="QUIT TO TITLE" full onClick={onQuit} />
          </div>
        </div>
      </div>
    </div>
  )
}
