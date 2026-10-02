/**
 * AgentContextRegistrar must register ONCE per window, not on every provider render.
 *
 * Measured 2026-10-01 on aitherium.com/?shell=aither-desktop: the registrar's effect
 * depended on the whole `useDesktopAgent()` value, which DesktopAgentProvider rebuilds
 * on every render. Registering forces a provider render, so every open window
 * re-registered forever (the provider's counter climbed ~6 per commit, nonstop). Opening
 * Settings added layout-phase updates to that storm and React aborted with
 * "Minified React error #185" (maximum update depth): Settings could not open at all.
 */
import React from 'react'
import { render, act } from '@testing-library/react'
import { DesktopAgentProvider, useDesktopAgent } from '../../../contexts/desktop-agent-context'
import { AgentContextRegistrar } from '../agent-context-registrar'

describe('AgentContextRegistrar', () => {
  beforeEach(() => {
    ;(global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
  })

  it('does not re-register on every provider render (no render storm)', async () => {
    let renders = 0
    const Probe = () => {
      useDesktopAgent()
      renders += 1
      // Fail the test instead of hanging it: a storm never settles on its own.
      if (renders > 60) throw new Error(`render storm: ${renders} provider renders`)
      return null
    }
    let caught: unknown = null
    class Boundary extends React.Component<{ children: React.ReactNode }, { err: unknown }> {
      state = { err: null as unknown }
      static getDerivedStateFromError(err: unknown) { return { err } }
      componentDidCatch(err: unknown) { caught = err }
      render() { return this.state.err ? null : this.props.children }
    }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await act(async () => {
        render(
          <Boundary>
            <DesktopAgentProvider>
              <AgentContextRegistrar windowId="terminal"><div /></AgentContextRegistrar>
              <AgentContextRegistrar windowId="strata"><div /></AgentContextRegistrar>
              <Probe />
            </DesktopAgentProvider>
          </Boundary>,
        )
      })
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    } finally {
      spy.mockRestore()
    }
    expect(caught).toBeNull()
    // Mount + one registration pass per window, then quiet.
    expect(renders).toBeLessThan(10)
  })

  it('still records each window\'s app context', async () => {
    let read: ReturnType<typeof useDesktopAgent> | null = null
    let n = 0
    const Reader = () => {
      read = useDesktopAgent()
      if (++n > 60) throw new Error('render storm')
      return null
    }
    await act(async () => {
      render(
        <DesktopAgentProvider>
          <AgentContextRegistrar windowId="terminal"><div /></AgentContextRegistrar>
          <Reader />
        </DesktopAgentProvider>,
      )
    })
    expect(read!.getWindowState('terminal').appContext?.appId).toBe('terminal')
  })
})
