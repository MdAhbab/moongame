// MARE NOCTIS — root state machine driving the full playable run.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Game } from './game/engine'
import BootScreen from './screens/BootScreen'
import LoadingScreen from './screens/LoadingScreen'
import TitleScreen from './screens/TitleScreen'
import SettingsScreen from './screens/SettingsScreen'
import TutorialScreen from './screens/TutorialScreen'
import BriefingScreen from './screens/BriefingScreen'
import PlayScreen from './screens/PlayScreen'
import PausedScreen from './screens/PausedScreen'
import WaveClearScreen, { type WaveSummary } from './screens/WaveClearScreen'
import DebriefScreen, { type DebriefData } from './screens/DebriefScreen'
import ResultsScreen, { type RunSummary } from './screens/ResultsScreen'
import CreditsScreen from './screens/CreditsScreen'

type Phase =
  | 'boot' | 'loading' | 'title' | 'tutorial' | 'settings' | 'credits'
  | 'briefing' | 'playing' | 'paused' | 'waveclear' | 'debrief' | 'results'

// Storage can throw in sandboxed iframes / private mode — never let it block play.
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

function genSeed() {
  return `NX-${1000 + Math.floor(Math.random() * 9000)}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`
}
function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot')
  const [prev, setPrev] = useState<Phase>('title')
  const gameRef = useRef<Game | null>(null)
  const [gameKey, setGameKey] = useState(0)
  const [seed, setSeed] = useState(genSeed())
  const [best, setBest] = useState(() => Number(safeGet('mn_best') || 0))
  const [firstVisit] = useState(() => !safeGet('mn_played'))
  const [waveSummary, setWaveSummary] = useState<WaveSummary | null>(null)
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null)
  const [debrief, setDebrief] = useState<DebriefData | null>(null)

  // Boot → Loading (momentary).
  useEffect(() => {
    if (phase === 'boot') {
      const t = setTimeout(() => setPhase('loading'), 900)
      return () => clearTimeout(t)
    }
  }, [phase])

  const newRun = useCallback((s: string) => {
    setSeed(s)
    gameRef.current = new Game(s)
    setGameKey((k) => k + 1)
    setPhase('briefing')
  }, [])

  const commitBest = useCallback((score: number) => {
    safeSet('mn_played', '1')
    if (score > best) { setBest(score); safeSet('mn_best', String(score)) }
  }, [best])

  const onWaveClear = useCallback((g: Game) => {
    const saved = g.outposts.filter((o) => o.state !== 'lost').length
    if (g.wave >= 12) {
      commitBest(g.score)
      setRunSummary({ score: g.score, best, wave: 12, saved, kills: g.totalKills, accuracy: g.accuracy, duration: fmtTime(g.runClock), seed: g.seed, victory: true })
      setPhase('results')
      return
    }
    setWaveSummary({ wave: g.wave, kills: g.killsThisWave, accuracy: g.accuracy, saved, total: g.score })
    setPhase('waveclear')
  }, [best, commitBest])

  const onGameOver = useCallback((g: Game) => {
    const saved = g.outposts.filter((o) => o.state !== 'lost').length
    commitBest(g.score)
    setRunSummary({ score: g.score, best, wave: g.wave, saved, kills: g.totalKills, accuracy: g.accuracy, duration: fmtTime(g.runClock), seed: g.seed, victory: false })
    if (g.losses.length) {
      const last = g.losses[g.losses.length - 1]
      setDebrief({
        cause: `Lost ${last.name} at ${fmtTime(last.t)} — harvesters drained it while you were elsewhere.`,
        seed: g.seed, saved, accuracy: g.accuracy, kills: g.totalKills,
      })
      setPhase('debrief')
    } else {
      setPhase('results')
    }
  }, [best, commitBest])

  const onPause = useCallback(() => setPhase('paused'), [])

  const startWaveAndPlay = () => {
    const g = gameRef.current!
    g.startWave(g.wave)
    setGameKey((k) => k + 1)
    setPhase('playing')
  }

  const g = gameRef.current
  const showPlay = (phase === 'playing' || phase === 'paused') && g

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      {phase === 'boot' && <BootScreen />}
      {phase === 'loading' && <LoadingScreen onComplete={() => setPhase('title')} />}

      {phase === 'title' && (
        <TitleScreen
          returning={!firstVisit && best > 0}
          best={best}
          onPlay={() => newRun(genSeed())}
          onTutorial={() => setPhase('tutorial')}
          onSettings={() => { setPrev('title'); setPhase('settings') }}
          onCredits={() => setPhase('credits')}
        />
      )}

      {phase === 'tutorial' && <TutorialScreen onDone={() => setPhase('title')} />}
      {phase === 'credits' && <CreditsScreen onBack={() => setPhase('title')} />}
      {phase === 'settings' && <SettingsScreen onBack={() => setPhase(prev)} />}

      {phase === 'briefing' && g && <BriefingScreen wave={g.wave} onStart={startWaveAndPlay} />}

      {showPlay && (
        <PlayScreen key={gameKey} game={g} paused={phase === 'paused'} onWaveClear={onWaveClear} onGameOver={onGameOver} onPause={onPause} />
      )}

      {phase === 'paused' && g && (
        <PausedScreen
          wave={g.wave}
          score={g.score}
          onResume={() => setPhase('playing')}
          onSettings={() => { setPrev('paused'); setPhase('settings') }}
          onRestart={() => newRun(seed)}
          onQuit={() => setPhase('title')}
        />
      )}

      {phase === 'waveclear' && waveSummary && (
        <WaveClearScreen summary={waveSummary} onContinue={() => { gameRef.current!.startWave(gameRef.current!.wave + 1); setPhase('briefing') }} />
      )}

      {phase === 'debrief' && (
        <DebriefScreen data={debrief ?? undefined} onRetry={() => newRun(seed)} onContinue={() => setPhase('results')} />
      )}

      {phase === 'results' && (
        <ResultsScreen summary={runSummary ?? undefined} victory={runSummary?.victory} onPlayAgain={() => newRun(genSeed())} />
      )}
    </div>
  )
}
