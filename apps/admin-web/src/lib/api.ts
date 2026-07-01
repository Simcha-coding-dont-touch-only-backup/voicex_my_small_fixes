import { supabase } from './supabase';

const API_BASE = '/api/admin';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${resp.status}`);
  }

  if (resp.headers.get('content-type')?.includes('application/json')) {
    return resp.json();
  }

  return resp as unknown as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'DELETE' };
  if (body !== undefined) init.body = JSON.stringify(body);
  return apiFetch<T>(path, init);
}

/**
 * Uploads a raw file (e.g. an audio recording) with its own content type.
 * The server reads the raw bytes — no multipart form needed.
 */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${API_BASE}${path}`, { headers });
  if (!resp.ok) throw new Error('Download failed');
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
