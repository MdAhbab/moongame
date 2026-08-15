// Placeholder stand-in for the real-time 3D scene rendered underneath the HUD.
// A dark void, a suggested curved lunar horizon, and a sparse star field.
// Deliberately reads as a stand-in, never as finished art.

type Props = {
  dimmed?: boolean
  lit?: boolean // brighter sunlit terrain, for showing text-scrim contrast
}

export default function WorldBackdrop({ dimmed = false, lit = true }: Props) {
  const stars = Array.from({ length: 90 }, (_, i) => {
    const seed = (i * 2654435761) % 100000
    return {
      x: (seed % 1000) / 10,
      y: ((seed >> 3) % 1000) / 10,
      r: ((seed >> 7) % 3) / 2 + 0.3,
      o: ((seed >> 5) % 60) / 100 + 0.15,
    }
  })

  return (
    <div className="absolute inset-0 overflow-hidden bg-void" aria-hidden>
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 100 100">
        {/* star field */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y * 0.62} r={s.r * 0.12} fill="#e8edf2" opacity={s.o} />
        ))}
      </svg>

      {/* Curved lunar horizon: a large sphere edge filling the lower portion. */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: '-118%',
          width: '260%',
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          background: lit
            ? 'radial-gradient(circle at 38% 22%, #cbc6bd 0%, #9a958c 26%, #47433d 58%, #1a1c22 78%, #0d1117 100%)'
            : 'radial-gradient(circle at 42% 26%, #3b4a63 0%, #2a3f5f 34%, #141c28 66%, #0b0e14 100%)',
          boxShadow: 'inset 0 6px 60px rgba(184,180,173,0.12)',
        }}
      />
      {/* terminator glow along the limb */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: '-118%',
          width: '260%',
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          boxShadow: '0 0 1px 1px rgba(127,232,255,0.06)',
          border: '1px solid rgba(184,180,173,0.10)',
        }}
      />

      {/* stand-in label so it's honestly a placeholder */}
      <span className="absolute bottom-3 right-4 hud-label opacity-30 select-none">3D SCENE · PLACEHOLDER</span>

      {dimmed && <div className="absolute inset-0 bg-void/70 backdrop-blur-md" />}
    </div>
  )
}
