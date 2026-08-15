/**
 * Per-screen error boundary (gameplan §38.5, Rule 10).
 *
 * "React error boundaries **per screen**. A HUD component failing must never
 * take down the game."
 *
 * The `screen` prop is what makes it per-screen rather than global: a fault is
 * attributed to the screen that caused it, and clears when the player navigates
 * away. Without it, one bad render wedges the entire app until reload — which
 * is the V1 failure mode (`alert()` then `location.reload()`) arriving by a
 * different route.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { logError } from '../../debug/logger.ts'

interface Props {
  children: ReactNode
  /** Which screen this boundary wraps. Changing it clears a caught error. */
  screen: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Rule 10 — never swallow an error. Enough context to debug it: which
    // screen, and the component stack that produced it.
    logError(`Screen "${this.props.screen}" failed`, error, info.componentStack ?? '')
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.screen !== this.props.screen && this.state.error !== null) {
      this.setState({ error: null })
    }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div role="alert" className="boundary">
        <h2>Something broke on this screen</h2>
        <p>
          The <strong>{this.props.screen}</strong> screen hit an error. The rest of the game is still running.
        </p>
        <pre>{error.message}</pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
