import { supabase } from './supabase';
import type { AgentFile, SessionWithFiles } from '@/types';

export async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token || ''}`,
  };
}

// Session API
export async function getSessions(): Promise<SessionWithFiles[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/sessions', { headers });
  if (!res.ok) throw new Error('Failed to fetch sessions');
  const { sessions } = await res.json();
  return sessions;
}

export async function getSession(sessionId: string): Promise<SessionWithFiles> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/${sessionId}`, { headers });
  if (!res.ok) throw new Error('Failed to fetch session');
  const { session } = await res.json();
  return session;
}

// Files API
export async function getSessionFiles(sessionId: string): Promise<AgentFile[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/files/sessions/${sessionId}/files`, { headers });
  if (!res.ok) throw new Error('Failed to fetch files');
  const { files } = await res.json();
  return files;
}

export async function getFileContent(signedUrl: string): Promise<string> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export async function restoreSession(sessionId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/files/sessions/${sessionId}/restore`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error('Failed to restore session');
}

// Stream agent query with session name and optional SDK session ID for resuming
export async function* streamAgentQuery(
  content: string,
  sessionName: string,
  sdkSessionId?: string
): AsyncGenerator<any> {
  const headers = await getAuthHeaders();

  const res = await fetch('/api/agent/query', {
    method: 'POST',
    headers: {
      ...headers,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ content, sessionName, sdkSessionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error('No response body');

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data);
        } catch (e) {
          console.error('Failed to parse SSE:', e);
        }
      }
    }
  }
}
