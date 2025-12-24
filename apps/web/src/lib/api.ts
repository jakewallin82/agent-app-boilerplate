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

export async function getSessionByName(sessionName: string): Promise<SessionWithFiles | null> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/by-name/${encodeURIComponent(sessionName)}`, { headers });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) throw new Error('Failed to fetch session');
  const { session } = await res.json();
  return session;
}

export interface StoredMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export async function getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/${sessionId}/messages`, { headers });
  if (!res.ok) throw new Error('Failed to fetch messages');
  const { messages } = await res.json();
  return messages;
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

/**
 * Pre-warm container with shared files
 * Call after successful login to reduce first-query latency
 */
export async function warmupAgent(agentId: string = 'default'): Promise<{ status: string; sessionName?: string; filesLoaded?: number; ttl?: number } | null> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/agent/warmup', {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId }),
    });

    if (!res.ok) {
      console.warn('[WARMUP] Warmup failed:', res.status);
      return null;
    }

    const result = await res.json();
    console.log('[WARMUP] Result:', result);
    return result;
  } catch (error) {
    // Ignore errors - warmup is best-effort
    console.warn('[WARMUP] Error:', error);
    return null;
  }
}

// Admin: Get all sessions
export async function getAdminSessions(): Promise<unknown[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/sessions/admin/all', { headers });
  if (!res.ok) {
    throw new Error('Failed to fetch admin sessions');
  }
  const { sessions } = await res.json();
  return sessions;
}

// Admin: Get session history
export async function getSessionHistory(sessionId: string): Promise<unknown> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/admin/${sessionId}/history`, { headers });
  if (!res.ok) {
    throw new Error('Failed to fetch session history');
  }
  return res.json();
}

// Session state from .session-state.json (own session or admin can view any)
export interface SessionState {
  messages: unknown[];
  [key: string]: unknown;
}

export async function getSessionState(sessionId: string): Promise<SessionState | null> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/${sessionId}/state`, { headers });

  if (!res.ok) {
    if (res.status === 404) {
      return null; // No session state file
    }
    throw new Error('Failed to fetch session state');
  }

  const data = await res.json();
  return data.sessionState;
}

/**
 * Reconnect to an active session stream after page refresh.
 * Returns buffered messages first, then continues streaming live.
 */
export async function* reconnectToSession(sessionId: string): AsyncGenerator<any> {
  const headers = await getAuthHeaders();

  const res = await fetch(`/api/agent/stream/${sessionId}`, {
    headers: {
      ...headers,
      'Accept': 'text/event-stream',
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      // No active stream - server finished before we could reconnect
      console.log('[RECONNECT] No active stream, session may have completed');
      return;
    }
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  // Same SSE parsing logic as streamAgentQuery
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
