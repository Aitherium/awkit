'use client'

/**
 * WidgetErrorBoundary
 * ====================
 * Catches errors in a single widget so one failing widget never takes down the
 * whole dashboard or desktop shell.
 *
 * Resilience features:
 * - First crash: silent auto-retry (remount with fresh key)
 * - Second crash: show "unavailable" placeholder with manual Retry button
 * - Auto-recovery timer: resets after 30s so user can try again naturally
 * - Never propagates errors upward — the rest of the app keeps running
 */

import React, { Component, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  widgetTitle?: string
  /** If true, skip the silent auto-retry on first error (for dialogs/overlays) */
  noAutoRetry?: boolean
}

interface State {
  hasError: boolean
  errorCount: number
  remountKey: number
}

const AUTO_RECOVERY_MS = 30_000

export class WidgetErrorBoundary extends Component<Props, State> {
  private _recoveryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorCount: 0, remountKey: 0 }
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    const title = this.props.widgetTitle || 'Widget'
    const count = this.state.errorCount + 1
    console.warn(`[WidgetErrorBoundary] ${title} error #${count}:`, error.message)

    // First crash and auto-retry not disabled: silently remount once
    if (count <= 1 && !this.props.noAutoRetry) {
      this.setState({ hasError: false, errorCount: count, remountKey: Date.now() })
      return
    }

    this.setState({ errorCount: count })

    // Schedule auto-recovery so the widget can heal when transient issues resolve
    this._clearRecoveryTimer()
    this._recoveryTimer = setTimeout(() => {
      this.handleRetry()
    }, AUTO_RECOVERY_MS)
  }

  componentWillUnmount() {
    this._clearRecoveryTimer()
  }

  private _clearRecoveryTimer() {
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer)
      this._recoveryTimer = null
    }
  }

  handleRetry = () => {
    this._clearRecoveryTimer()
    this.setState({ hasError: false, errorCount: 0, remountKey: Date.now() })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full min-h-[120px] p-4 text-center text-muted-foreground text-sm border border-dashed border-muted rounded-lg bg-muted/5">
          <div>
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{this.props.widgetTitle ? `${this.props.widgetTitle} unavailable` : 'Widget unavailable'}</p>
            <p className="text-xs mt-1 mb-3">Services may be offline</p>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        </div>
      )
    }
    return (
      <React.Fragment key={this.state.remountKey}>
        {this.props.children}
      </React.Fragment>
    )
  }
}
