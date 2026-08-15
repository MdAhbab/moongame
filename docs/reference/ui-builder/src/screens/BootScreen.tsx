import { Button } from '../game/ui'

// BOOT is momentary: wordmark on void. If WebGL2 is missing we show the actual
// problem and name browsers that work — never a blank screen or generic error.
export default function BootScreen({ webglError = false }: { webglError?: boolean }) {
  if (webglError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-void p-8">
        <div className="max-w-md">
          <div className="hud-label" style={{ color: 'var(--color-hostile)' }}>Cannot Start</div>
          <h1 className="mt-2 font-hud text-[32px] font-semibold leading-tight">
            This browser has no WebGL2.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            MARE NOCTIS builds its moon in real time on your GPU, which needs WebGL2. Your current browser
            reports it as unavailable — often because hardware acceleration is switched off, or the browser is
            older than this game.
          </p>
          <p className="mt-3 text-[16px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            It runs well on a recent <span style={{ color: 'var(--color-text-primary)' }}>Chrome</span>,{' '}
            <span style={{ color: 'var(--color-text-primary)' }}>Firefox</span>, or{' '}
            <span style={{ color: 'var(--color-text-primary)' }}>Safari 15+</span> with hardware acceleration enabled.
          </p>
          <div className="mt-6">
            <Button label="TEST WEBGL2 AGAIN" primary />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-void">
      <h1 className="font-hud text-[48px] font-bold tracking-widest opacity-90 enter-overshoot" style={{ letterSpacing: '0.18em' }}>
        MARE NOCTIS
      </h1>
    </div>
  )
}
