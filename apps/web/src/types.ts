// Content block types from SDK
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock;

// Chat message for display
export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: Date;
  isStreaming?: boolean;
}

// Subagent tool call
export interface SubagentToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
  status: 'running' | 'completed' | 'failed';
  timestamp: Date;
}

// Subagent state
export interface Subagent {
  id: string;
  type: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  toolCalls: SubagentToolCall[];
}

// Timeline item for rendering order
export type TimelineItem =
  | { type: 'message'; id: string; timestamp: Date }
  | { type: 'subagent'; id: string; timestamp: Date };

// Session storage key
export const SESSION_STORAGE_KEY = 'agent-session-id';
