import type { SearchHit, SessionDetail, SessionSummary } from './types';

export interface SessionChange {
  sessionId: string;
  file: string;
  kind: 'added' | 'updated';
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export function fetchSessions(): Promise<SessionSummary[]> {
  return getJson<SessionSummary[]>('/api/sessions');
}

export function fetchSession(id: string): Promise<SessionDetail> {
  return getJson<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function searchAll(q: string): Promise<SearchHit[]> {
  const data = await getJson<{ query: string; results: SearchHit[] }>(
    `/api/search?q=${encodeURIComponent(q)}`,
  );
  return data.results;
}

/**
 * SSE stream of session changes from /api/events. EventSource reconnects on
 * its own after a drop, so the caller only gets a teardown function. When
 * the server has no live source the endpoint 404s and this stays silent.
 */
export function subscribeSessionChanges(onChange: (change: SessionChange) => void): () => void {
  const source = new EventSource('/api/events');
  const listener = (ev: MessageEvent) => {
    try {
      onChange(JSON.parse(ev.data as string) as SessionChange);
    } catch {
      // malformed payload: ignore it
    }
  };
  source.addEventListener('session', listener);
  return () => {
    source.removeEventListener('session', listener);
    source.close();
  };
}
