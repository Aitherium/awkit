'use client'

/**
 * DashboardErrorBoundary
 * Catches errors so the page is never completely disabled.
 * On first catch: remount children once (so real neural field / UI can render).
 * On second catch: show warning banner BUT STILL render children — individual
 * widget failures are caught by WidgetErrorBoundary.  If even the dashboard
 * shell itself crashes again, the InnerFallback shows a minimal recovery UI.
 */

import React, { Component, type ReactNode } from 'react'
import { Button } from '../ui/button'
import { RefreshCw, AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
  remountKey: number
}

/**
 * InnerFallback — nested boundary used inside the degraded fallback render.
 * If children crash a third time (e.g. SystemStateProvider itself is broken),
 * show a minimal recovery UI instead of a blank screen.
 */
class InnerFallback extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  constructor(props: { children: ReactNode; onRetry: () => void }) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('[DashboardErrorBoundary:InnerFallback]', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-md">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500/60" />
            <h2 className="text-lg font-semibold text-white/80">Dashboard failed to load</h2>
            <p className="text-sm text-muted-foreground">
              Some core components couldn&apos;t initialize. This usually means backend services are starting up.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="default" onClick={this.props.onRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Hard Refresh
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0, remountKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[DashboardErrorBoundary]', error, errorInfo.componentStack)
    // First catch: give the tree one more chance by remounting (stale closure / race can cause one-time throws)
    if (this.state.retryCount < 1) {
      this.setState({
        hasError: false,
        error: null,
        retryCount: 1,
        remountKey: Date.now(),
      })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, retryCount: 0, remountKey: Date.now() })
  }

  render() {
    // After one silent remount and a second failure: show banner BUT STILL render children.
    // Individual widget crashes are caught by WidgetErrorBoundary.
    // If the dashboard shell itself is broken, InnerFallback catches it.
    if (this.state.hasError && this.state.retryCount >= 1) {
      return (
        <div className="min-h-screen bg-background flex flex-col">
          <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 flex items-center justify-between gap-4 flex-wrap shrink-0 z-50">
            <p className="text-sm text-amber-200/90">
              Some features unavailable. UI is still usable — try again or refresh.
            </p>
            <Button size="sm" variant="default" onClick={this.handleRetry}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Try again
            </Button>
          </div>
          <InnerFallback onRetry={this.handleRetry}>
            <React.Fragment key={`fallback-${this.state.remountKey}`}>
              {this.props.children}
            </React.Fragment>
          </InnerFallback>
        </div>
      )
    }

    // Normal render, or first retry: show real UI (remount key forces fresh tree after catch)
    return (
      <React.Fragment key={this.state.remountKey}>
        {this.props.children}
      </React.Fragment>
    )
  }
}
