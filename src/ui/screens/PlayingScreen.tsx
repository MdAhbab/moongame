import { ThreatRing } from '../hud/ThreatRing'
import { Reticle } from '../hud/Reticle'
import { hudRefs } from '../../state/hudRefs'
import { OutpostRoster } from '../hud/OutpostRoster'
import { HullGauge } from '../hud/HullGauge'
import { HeatGauge } from '../hud/HeatGauge'
import { ComboMeter } from '../hud/ComboMeter'
import { AltitudeLadder } from '../hud/AltitudeLadder'
import { SpeedReadout } from '../hud/SpeedReadout'
import { Horizon } from '../hud/Horizon'
import { DamageVignette } from '../hud/DamageVignette'
import { AlertBand } from '../hud/AlertBand'
import { TouchControls } from '../hud/TouchControls'
import { OrbitalMap } from '../hud/OrbitalMap'
import { ControlsHint } from '../hud/ControlsHint'
import styles from './PlayingScreen.module.css'

export function PlayingScreen({ showHint = true }: { showHint?: boolean }) {
  // §17.2: ZERO REACT RE-RENDERS DURING PLAYING.
  // This component mounts the HUD structure once. Data flows directly into DOM refs.
  return (
    <div className={styles.playingContainer}>
      <Horizon />
      {/* The aim marks sit above the horizon and below every panel: they are
          drawn *in* the world, so anything the player reads has to win. */}
      <Reticle />
      <DamageVignette />

      {/* Safe Area Inset Container for HUD elements */}
      <div className={styles.hudOverlay}>
        
        {/* Top-Left: Hull & Heat */}
        <div className={styles.topLeft}>
          <HullGauge />
          <HeatGauge />
        </div>
        
        {/* Top-Right: Score, Combo, Wave */}
        <div className={styles.topRight}>
          <ComboMeter />
          <div className={styles.waveLabel}>
            WAVE <span ref={(el) => { hudRefs.waveText = el }}>1</span>
          </div>
          {import.meta.env.DEV && (
            <div className={styles.drawCalls}>
              DC: <span ref={(el) => { hudRefs.drawCallsText = el }}>0</span>
            </div>
          )}
        </div>

        {/* Left: Outposts */}
        <div className={styles.leftCenter}>
          <OutpostRoster />
        </div>

        {/* Right: Altitude and airspeed */}
        <div className={styles.rightCenter}>
          <AltitudeLadder />
          <SpeedReadout />
        </div>

        {/* Bottom-Left: Boost & Bombs */}
        <div className={styles.bottomLeft}>
          <div className={styles.boostGauge}>
            <span className={styles.boostLabel}>⚡ BOOST</span>
            <div className={styles.boostTrack}>
               <div ref={(el) => { hudRefs.boostFill = el }} className={styles.boostFill} />
            </div>
          </div>
          <div className={styles.bombGauge}>
            <span className={styles.boostLabel}>💣 BOMB (<span ref={(el) => { hudRefs.bombText = el }}>READY</span>)</span>
            <div className={styles.bombTrack}>
               <div ref={(el) => { hudRefs.bombFill = el }} className={styles.bombFill} />
            </div>
          </div>
        </div>

        {/* Bottom-Center: Weapon & Engine Mode */}
        <div className={styles.bottomCenter}>
          <div className={styles.modeCluster}>
            <span className={styles.weaponModePill} ref={(el) => { hudRefs.weaponModeText = el }}>PULSE CANNON</span>
            <span className={styles.engineStatus} ref={(el) => { hudRefs.engineModeText = el }}>PROPULSION [ACTIVE]</span>
          </div>
          <span className={styles.aegisStatus} ref={(el) => { hudRefs.aegisText = el }} style={{ display: 'none' }}>
            AEGIS SHIELD: 0
          </span>
          {/* Craft condition: which system is hurt, and what is flying with you. */}
          <div className={styles.conditionCluster}>
            <span className={styles.systemPip} ref={(el) => { hudRefs.systemEngine = el }} title="Engine">⚙ ENG</span>
            <span className={styles.systemPip} ref={(el) => { hudRefs.systemWeapon = el }} title="Weapon bay">⌁ WPN</span>
            <span className={styles.systemPip} ref={(el) => { hudRefs.systemControl = el }} title="Stabiliser">⇅ CTL</span>
            <span className={styles.dronePip} ref={(el) => { hudRefs.droneCount = el }} style={{ display: 'none' }}>🛰 ×1 READY</span>
            <span className={styles.lancePip} ref={(el) => { hudRefs.lanceCharge = el }} style={{ display: 'none' }}>☀ 0%</span>
          </div>
        </div>

        {/* Bottom-Right: Target, Lock Status & Flares */}
        <div className={styles.bottomRight}>
          <div className={styles.targetBlock}>
            <div className={styles.targetName} ref={(el) => { hudRefs.targetReadout = el }}>NO TARGET</div>
            <div className={styles.targetHealthTrack}>
              <div className={styles.targetHealthFill} ref={(el) => { hudRefs.targetHealthFill = el }} />
            </div>
          </div>
          <div className={styles.lockStatus}>
             ⌖ LOCK <span ref={(el) => { hudRefs.lockProgress = el }}>—</span>
          </div>
          <div className={styles.flareStatus} ref={(el) => { hudRefs.flareText = el }}>
             FLARES: 5
          </div>
        </div>

        {/* Center: Threat Ring */}
        <div className={styles.center}>
          <ThreatRing />
        </div>

      </div>

      <AlertBand />
      {/* Suppressed under the Tutorial, which shows its own beat card in the
          same corner and would otherwise stack two explanations on top of
          each other. */}
      {showHint && <ControlsHint />}
      <TouchControls />
      <OrbitalMap />
    </div>
  )
}
