export type AmbientOrbState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'permission'
  | 'unsupported'
  | 'privacy_required';

interface AmbientOrbProps {
  state: AmbientOrbState;
  size?: number;
  className?: string;
}

const CALM_STATES = new Set<AmbientOrbState>(['error', 'permission', 'unsupported', 'privacy_required']);

/**
 * VEYRA's ambient hero visual. Every animated variant is CSS-driven (see
 * styles/brand.css) and automatically disabled under `prefers-reduced-motion`;
 * there is no canvas/WebGL and no fabricated audio-reactivity — the states
 * reflect real interaction state (listening/thinking/speaking), not simulated
 * amplitude data.
 */
export default function AmbientOrb({ state, size = 260, className = '' }: AmbientOrbProps) {
  const calm = CALM_STATES.has(state);
  const activeRingState = state === 'thinking' ? 'thinking' : 'idle';
  const showWaveBars = state === 'listening' || state === 'speaking';

  return (
    <div
      aria-hidden="true"
      className={`relative flex items-center justify-center ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      {/* Outer concentric rings */}
      <div
        data-state={activeRingState}
        className="veyra-ring absolute rounded-full"
        style={{
          width: '100%',
          height: '100%',
          border: `1px solid ${calm ? 'rgba(148,163,184,0.25)' : 'rgba(19,200,177,0.3)'}`,
        }}
      />
      <div
        data-state={activeRingState}
        className="veyra-ring veyra-ring--rev absolute rounded-full"
        style={{
          width: '78%',
          height: '78%',
          border: `1px solid ${calm ? 'rgba(148,163,184,0.2)' : 'rgba(42,200,189,0.28)'}`,
        }}
      />

      {/* Core orb */}
      <div
        data-state={state}
        className="veyra-orb-core relative flex items-center justify-center rounded-full"
        style={{
          width: '58%',
          height: '58%',
          background: calm
            ? 'radial-gradient(circle at 35% 30%, rgba(148,163,184,0.35) 0%, rgba(15,23,42,0.9) 65%)'
            : 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.55) 0%, rgba(42,200,189,0.6) 22%, rgba(19,200,177,0.65) 55%, rgba(11,174,154,0.55) 85%)',
          boxShadow: calm ? '0 0 40px rgba(100,116,139,0.25)' : 'var(--brand-glow-violet), var(--brand-glow-cyan)',
        }}
      >
        <svg width="46%" height="46%" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path
            d="M6 20h4l2-7 3 14 2.6-9.5 2 3H32"
            fill="none"
            stroke={calm ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.85)'}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Activity bars — real state indicator, not simulated amplitude */}
      {showWaveBars && (
        <div className="absolute bottom-[6%] flex items-end gap-1" style={{ height: '10%' }}>
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              className="veyra-wave-bar block w-1 rounded-full"
              style={{
                height: '100%',
                background: 'var(--brand-gradient-ai)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
