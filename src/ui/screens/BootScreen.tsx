import { useEffect, useState } from 'react'
import { useGameStore } from '../../state/useGameStore'
import { Button } from '../components/ui'
import styles from './BootScreen.module.css'

export function BootScreen() {
  const goto = useGameStore(s => s.goto)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Capability detection, WebGL2 check
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) {
      setError('WebGL2 is required but not supported by your browser or hardware acceleration is disabled. (Check Safari, Chrome, or Firefox settings)')
      return undefined
    } else {
      // If capabilities check passes, proceed to loading
      const timer = setTimeout(() => {
        goto('Loading')
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [goto])

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>MARE NOCTIS</h1>
      {error ? (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <Button label="RETRY" primary onClick={() => window.location.reload()} />
        </div>
      ) : (
        <div className={styles.detecting}>Detecting capabilities...</div>
      )}
    </div>
  )
}
