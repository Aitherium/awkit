// @vitest-environment jsdom
/**
 * ApplianceConsole: session probe -> code screen -> setup-mode lock -> hash routing.
 * Rendered for real (react-dom in jsdom) against a fake ApplianceClient.
 */
import { afterEach, beforeEach, describe, expect, it, vi as vitestVi } from 'vitest'
// These suites run under vitest AND under AitherVeil's jest (its roots include awkit/src,
// with `vitest` mapped to jest.vitest-shim.ts, whose `vi` is undefined because jest's
// `jest` object is module-scoped, not global). Take whichever mock namespace exists.
declare const jest: typeof vitestVi | undefined
const vi: typeof vitestVi = typeof jest !== 'undefined' && jest ? jest : vitestVi
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { ApplianceConsole } from '../appliance/ApplianceConsole'
import { SurfacesPanel } from '../appliance/SurfacesPanel'
import type { ApplianceClient } from '../appliance/client'
import type { ApiResult, ApplianceTab, Session, Surfaces } from '../appliance/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ok = <T,>(data: T): ApiResult<T> => ({ state: 'ok', status: 200, data })

function session(over: Partial<Session>): ApiResult<Session> {
  return ok({ mode: 'console', authenticated: true, profile: 'acme', brand: 'AcmeBot', variant: 'acme-appliance', ...over })
}

function fakeClient(over: Partial<ApplianceClient> = {}): ApplianceClient {
  const unavailable = async () => ({ state: 'unavailable' as const, status: 503, data: null })
  return {
    apiBase: '',
    session: vi.fn(async () => session({})),
    login: vi.fn(async () => ok({ authenticated: true, mode: 'console' as const })),
    logout: vi.fn(async () => ok({ authenticated: false })),
    overview: unavailable,
    license: unavailable,
    updates: unavailable,
    components: unavailable,
    endpoints: unavailable,
    surfaces: unavailable,
    setupStatus: unavailable,
    setupSteps: unavailable,
    setupState: unavailable,
    applySetupStep: unavailable,
    finishSetup: unavailable,
    action: unavailable,
    getJson: unavailable,
    ...over,
  } as ApplianceClient
}

const Probe = (name: string) => () => <p data-testid="panel">{name} panel</p>
const TABS: ApplianceTab[] = [
  { id: 'setup', label: 'Setup', Component: Probe('setup') },
  { id: 'overview', label: 'Overview', Component: Probe('overview') },
  { id: 'updates', label: 'Updates', Component: Probe('updates') },
]

let host: HTMLDivElement
let root: Root

async function render(client: ApplianceClient, tabs = TABS) {
  await act(async () => {
    root.render(<ApplianceConsole apiBase="" tabs={tabs} client={client} />)
  })
  // let the session promise and effects settle
  await act(async () => {
    await Promise.resolve()
  })
}

const text = () => host.textContent ?? ''
const tabLabels = () => Array.from(host.querySelectorAll('nav a')).map((a) => a.textContent)

beforeEach(() => {
  window.location.hash = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ApplianceConsole', () => {
  it('shows the code screen with the console-mode hint when not signed in', async () => {
    await render(fakeClient({ session: vi.fn(async () => session({ authenticated: false })) }))
    expect(host.querySelector('form[aria-label="Sign in"]')).not.toBeNull()
    expect(text()).toContain('sudo awnix console code')
    expect(text()).toContain('AcmeBot')
    expect(host.querySelector('[data-testid="panel"]')).toBeNull()
  })

  it('setup mode: the hint points at the machine screen, and only the setup tab renders', async () => {
    let authed = false
    const client = fakeClient({
      session: vi.fn(async () => session({ mode: 'setup', authenticated: authed })),
      login: vi.fn(async () => {
        authed = true
        return ok({ authenticated: true, mode: 'setup' as const })
      }),
    })
    await render(client)
    expect(text()).toContain('setup code shown on this machine')
    const input = host.querySelector('input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'abcde23456')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(client.login).toHaveBeenCalledWith('ABCDE23456')
    expect(text()).toContain('setup panel')
    expect(tabLabels()).toEqual([]) // a single tab needs no tab bar
    window.location.hash = '#/updates'
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(text()).toContain('setup panel')
    expect(text()).not.toContain('updates panel')
  })

  it('console mode: every tab, hash routing selects one', async () => {
    window.location.hash = '#/updates'
    await render(fakeClient())
    expect(tabLabels()).toEqual(['Setup', 'Overview', 'Updates'])
    expect(text()).toContain('updates panel')
    const overview = Array.from(host.querySelectorAll('nav a')).find((a) => a.textContent === 'Overview')!
    await act(async () => {
      ;(overview as HTMLAnchorElement).click()
    })
    expect(window.location.hash).toBe('#/overview')
    expect(text()).toContain('overview panel')
  })

  it('a locked login says so with the wait', async () => {
    await render(
      fakeClient({
        session: vi.fn(async () => session({ authenticated: false })),
        login: vi.fn(async () => ({ state: 'locked' as const, status: 423, data: null, retryAfter: 42 })),
      }),
    )
    const input = host.querySelector('input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'WRONGWRONG')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('42 seconds')
  })

  it('an unreachable console is an explicit notice, not a blank page', async () => {
    await render(fakeClient({ session: vi.fn(async () => ({ state: 'unavailable' as const, status: 0, data: null, detail: 'down' })) }))
    expect(host.querySelector('[data-state="unavailable"]')).not.toBeNull()
    expect(text()).toContain('Try again')
  })
})

describe('SurfacesPanel', () => {
  it('renders links, a BUSL note, and the after-activation notice', async () => {
    const data: Surfaces = {
      variant: 'acme-appliance',
      console: { bind: '0.0.0.0', profile: 'acme', brand: 'AcmeBot' },
      surfaces: [
        { id: 'console', label: 'Appliance console', delivery: 'baked', licence: 'Apache-2.0' },
        { id: 'acme_ui', label: 'AcmeBot', delivery: 'baked', licence: 'commercial', url: 'http://box:8900' },
        { id: 'veil', label: 'Veil', delivery: 'link', licence: 'BUSL-1.1', url: 'https://aitherium.com' },
        { id: 'awdesk', label: 'AitherDesktop', delivery: 'image-private', licence: 'BUSL-1.1' },
        { id: 'awsh', label: 'awsh', delivery: 'baked', licence: 'Apache-2.0', command: 'awsh' },
      ],
    }
    const client = fakeClient({ surfaces: vi.fn(async () => ok(data)) })
    await act(async () => {
      root.render(<SurfacesPanel client={client} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(host.querySelector('[data-surface="console"]')).toBeNull()
    const links = Array.from(host.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.getAttribute('rel')])
    expect(links).toContainEqual(['http://box:8900', 'noopener noreferrer'])
    expect(links).toContainEqual(['https://aitherium.com', 'noopener noreferrer'])
    const desk = host.querySelector('[data-surface="awdesk"]')!
    expect(desk.querySelector('a')).toBeNull()
    expect(desk.textContent).toContain('license is active')
    expect(host.querySelector('[data-surface="veil"]')!.textContent).toContain('personal and non-commercial')
    expect(host.querySelector('[data-surface="awsh"] code')?.textContent).toBe('awsh')
  })
})
