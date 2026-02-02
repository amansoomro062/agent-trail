import type { SearchHit, SessionDetail, SessionSummary } from './types';

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
