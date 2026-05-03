import { getJson, postJson } from "./http";
import type { LiveSessionsResponse, SessionResponse } from "../types/backend";

export function startSession(payload: Record<string, unknown>) {
  return postJson<SessionResponse>("/api/session", payload);
}

export function restartSession(payload: Record<string, unknown>) {
  return postJson<SessionResponse>("/api/session/restart", payload);
}

export function shutdownSession(sessionId: string, clientId: string) {
  return postJson<{ ok: boolean }>("/api/shutdown", { sessionId, clientId });
}

export function listLiveSessions(params: { clientId: string; workspacePath?: string }) {
  const query = new URLSearchParams();
  if (params.clientId) query.set("clientId", params.clientId);
  if (params.workspacePath) query.set("workspacePath", params.workspacePath);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return getJson<LiveSessionsResponse>(`/api/live-sessions${suffix}`);
}
