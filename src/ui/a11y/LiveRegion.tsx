import { useEffect, useState } from 'react'
import { useGameStore } from '../../state/useGameStore'

export function LiveRegion() {
  // We can track alerts, wave changes, and game over states to announce them
  const alertText = useGameStore(s => s.alert)
  const waveSummary = useGameStore(s => s.waveSummary)
  const screen = useGameStore(s => s.screen)
  const runSummary = useGameStore(s => s.runSummary)
  
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (alertText) setAnnouncement(alertText)
  }, [alertText])

  useEffect(() => {
    if (screen === 'WaveClear' && waveSummary) {
      setAnnouncement(`Wave ${waveSummary.wave} cleared. ${waveSummary.outpostsSaved} outposts saved.`)
    } else if (screen === 'Results' && runSummary) {
      setAnnouncement(`Run ended. Final score: ${runSummary.finalScore}.`)
    }
  }, [screen, waveSummary, runSummary])

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {announcement}
    </div>
  )
}
