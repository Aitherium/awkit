/**
 * Sessions Panel (the `sessions` panel id) — Claude Code / agent sessions in this workspace.
 *
 * One renderer for agent sessions everywhere (owner, 2026-10-18): this is
 * AgentSessionsPanel over the workspace harness router, so a tenant portal shows the
 * same list, transcript, message box, Stop, quick answers and Start as AitherOS Online,
 * AitherDesktop and the Android app. The daemon bearer never reaches the browser.
 */

import React, { useMemo } from "react";
import { AgentSessionsPanel } from "./AgentSessionsPanel";
import { workspaceSessionsTransport } from "../lib/workspaceSessionsTransport";

export const SessionsPanel: React.FC = () => {
  const transport = useMemo(() => workspaceSessionsTransport(), []);
  return <AgentSessionsPanel transport={transport} title="Sessions" />;
};

export default SessionsPanel;
