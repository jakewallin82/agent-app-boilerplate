// Agent message types (matching SDK output)
export interface AgentMessage {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: 'init' | 'thinking' | 'tool_use' | 'tool_result' | 'text';
  content?: string;
  session_id?: string;
  parent_tool_use_id?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface ChatSession {
  id: string; // This IS the SDK session ID
  user_id: string;
  agent_id: string;
  session_name?: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

// Request type for session creation with agent config
export interface CreateSessionRequest {
  sessionName: string;
  agentId: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AgentFile {
  id: string;
  session_id: string;
  user_id: string;
  file_path: string;
  storage_path: string;
  file_type?: string;
  file_size?: number;
  created_at: string;
}

// Session state for dev mode debugging
export interface SessionState {
  version: string;
  sessionId: string;
  sessionName: string;
  agentId: string;
  userId: string;
  startTime: string;
  endTime?: string;
  messages: unknown[];  // Full SDK message stream (typed as unknown to avoid SDK dependency)
  metadata: {
    totalTokens: number;
    totalCost: number;
    toolCallCount: number;
    subagentCount: number;
  };
}
