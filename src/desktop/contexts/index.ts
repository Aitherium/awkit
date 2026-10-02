// Re-export the context hooks so the bare `@aitheros/desktop-core/contexts`
// import resolves (the agent-integration contract references this path —
// check_deploy_invariants flagged it missing, 2026-08-30).
export { useWindowAgent } from './desktop-agent-context'
export { useAgentControlBus } from './agent-control-bus'
