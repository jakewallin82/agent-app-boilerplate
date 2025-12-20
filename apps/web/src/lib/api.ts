import { supabase } from './supabase';

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token || ''}`,
  };
}

// Create or get session - uses SDK session ID as the primary key
export async function ensureSession(sessionId: string): Promise<{ id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: sessionId }),
  });

  if (!res.ok) throw new Error('Failed to create session');
  const { session } = await res.json();
  return session;
}

// Get session by ID (session ID = SDK session ID)
export async function getSession(sessionId: string): Promise<{ id: string } | null> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers,
  });

  if (!res.ok) return null;
  const { session } = await res.json();
  return session;
}

// Get messages for a session
export async function getSessionMessages(sessionId: string): Promise<Array<{ role: string; content: string; created_at: string }>> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    headers,
  });

  if (!res.ok) return [];
  const { messages } = await res.json();
  return messages;
}

// Save a message to a session
export async function saveMessage(sessionId: string, role: 'user' | 'assistant', content: string): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role, content }),
  });
}

// Stream agent query - sessionId is optional (SDK handles resume via sdkSessionId)
export async function* streamAgentQuery(
  content: string,
  sdkSessionId?: string
): AsyncGenerator<any> {
  const headers = await getAuthHeaders();

  const res = await fetch('/api/agent/query', {
    method: 'POST',
    headers: {
      ...headers,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ content, sdkSessionId }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
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
