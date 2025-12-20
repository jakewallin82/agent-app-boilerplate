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
  title?: string;
  created_at: string;
  updated_at: string;
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
