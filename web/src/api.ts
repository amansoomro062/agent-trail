import type { ProviderName, SearchHit, SessionDetail, SessionSummary } from './types';

export interface SessionChange {
  sessionId: string;
  file: string;
  kind: 'added' | 'updated' | 'removed';
}

export interface RootInfo {
  path: string;
  provider: ProviderName;
  label?: string;
  custom: boolean;
  sessions: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

/** POST/DELETE with a JSON body; throws the server's error message on !ok. */
async function sendJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `${url} → ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
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

export async function fetchRoots(): Promise<RootInfo[]> {
  const data = await getJson<{ roots: RootInfo[] }>('/api/roots');
  return data.roots;
}

export async function addRoot(path: string): Promise<RootInfo> {
  const data = await sendJson<{ root: RootInfo }>('/api/roots', 'POST', { path });
  return data.root;
}

export async function removeRoot(path: string): Promise<void> {
  await sendJson('/api/roots', 'DELETE', { path });
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
