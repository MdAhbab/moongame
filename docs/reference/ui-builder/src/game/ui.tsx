import { useState, type ReactNode } from 'react'

// Shared instrument-grade controls. 2px radius, 1px strokes, transparent fill;
// filled only for the single primary action on a screen.

export function Button({
  label,
  primary,
  disabled,
  onClick,
  full,
}: {
  label: string
  primary?: boolean
  disabled?: boolean
  onClick?: () => void
  full?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-6 py-2.5 font-hud text-[15px] font-semibold transition-[background,border-color,color] duration-200 ${full ? 'w-full' : ''}`}
      style={{
        border: `1px solid ${disabled ? 'var(--color-inert)' : primary ? 'var(--color-friendly)' : 'rgba(139,151,166,0.32)'}`,
        background: primary && !disabled ? 'rgba(127,232,255,0.14)' : 'transparent',
        color: disabled ? 'var(--color-inert)' : primary ? 'var(--color-friendly)' : 'var(--color-text-primary)',
        borderRadius: 2,
        letterSpacing: '0.06em',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  suffix = '%',
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  suffix?: string
  onChange?: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="hud-label">{label}</span>
        <span className="font-hud text-[14px] tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
          {value}
          {suffix}
        </span>
      </div>
      <div className="relative h-6">
        <div className="absolute top-1/2 h-px w-full -translate-y-1/2" style={{ background: 'rgba(139,151,166,0.3)' }} />
        <div className="absolute top-1/2 h-px -translate-y-1/2" style={{ width: `${pct}%`, background: 'var(--color-friendly)' }} />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-[var(--color-friendly)]"
          style={{ margin: 0 }}
          aria-label={label}
        />
      </div>
    </label>
  )
}

export function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: boolean
  onChange?: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-1">
      <div>
        <div className="font-hud text-[15px] font-medium" style={{ letterSpacing: '0.02em' }}>{label}</div>
        {description && <p className="mt-1 max-w-md text-[14px]" style={{ color: 'var(--color-text-secondary)' }}>{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange?.(!value)}
        className="relative mt-1 flex h-6 w-11 shrink-0 items-center px-0.5 transition-colors duration-200"
        style={{ border: `1px solid ${value ? 'var(--color-friendly)' : 'rgba(139,151,166,0.4)'}`, borderRadius: 2 }}
      >
        <span
          className="h-4 w-4 transition-transform duration-200"
          style={{ background: value ? 'var(--color-friendly)' : 'var(--color-inert)', transform: value ? 'translateX(20px)' : 'translateX(0)', borderRadius: 1 }}
        />
      </button>
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 border-b" style={{ borderColor: 'rgba(139,151,166,0.18)' }}>
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className="px-4 py-2 font-hud text-[13px] font-medium tracking-widest transition-colors duration-150"
          style={{
            color: active === t ? 'var(--color-friendly)' : 'var(--color-text-secondary)',
            borderBottom: `2px solid ${active === t ? 'var(--color-friendly)' : 'transparent'}`,
            textTransform: 'uppercase',
            marginBottom: -1,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

export function KeyBindingRow({ action, keyLabel }: { action: string; keyLabel: string }) {
  const [rebinding, setRebinding] = useState(false)
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid rgba(139,151,166,0.12)' }}>
      <span className="font-hud text-[15px]" style={{ letterSpacing: '0.02em' }}>{action}</span>
      <button
        onClick={() => setRebinding((r) => !r)}
        className={`min-w-[92px] px-3 py-1.5 text-center font-hud text-[13px] font-semibold tracking-wide ${rebinding ? 'pulse-slow' : ''}`}
        style={{
          border: `1px solid ${rebinding ? 'var(--color-caution)' : 'rgba(139,151,166,0.32)'}`,
          color: rebinding ? 'var(--color-caution)' : 'var(--color-text-primary)',
          borderRadius: 2,
        }}
      >
        {rebinding ? 'PRESS A KEY…' : keyLabel}
      </button>
    </div>
  )
}

export function Toast({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warning'; icon?: string }) {
  const color = tone === 'warning' ? 'var(--color-caution)' : 'var(--color-friendly)'
  return (
    <div
      className="enter-overshoot flex items-center gap-3 px-4 py-2.5"
      style={{ border: `1px solid ${color}`, background: 'rgba(21,27,36,0.9)', backdropFilter: 'blur(8px)', borderRadius: 2 }}
    >
      {icon && <span style={{ color }}>{icon}</span>}
      <span className="text-[14px]" style={{ color: 'var(--color-text-primary)' }}>{children}</span>
    </div>
  )
}
