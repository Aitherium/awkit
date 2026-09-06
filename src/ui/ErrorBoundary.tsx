import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}
interface State { hasError: boolean; error: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', minHeight: 300,
        padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: 16, opacity: 0.5 }}>!</div>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Something went wrong</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 20, maxWidth: 400 }}>
          {this.state.error || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={() => { this.setState({ hasError: false, error: '' }) }}
          style={{
            padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
            borderRadius: 'var(--radius)', fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </div>
    )
  }
}
