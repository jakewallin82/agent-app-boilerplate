import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  streamAgentQuery,
  ensureSession,
  getSession,
  getSessionMessages,
  saveMessage,
} from '@/lib/api';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type {
  ChatMessage,
  Subagent,
  SubagentToolCall,
  TimelineItem,
  ContentBlock,
  ToolUseBlock,
} from '@/types';

const STORAGE_KEY = 'agent-session-id';

// Extract text content from SDK message
function extractTextContent(message: any): string {
  if (message.type !== 'assistant') return '';
  const content = message.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text || '')
    .join('');
}

// Extract content blocks from SDK message
function extractContentBlocks(message: any): ContentBlock[] {
  if (message.type !== 'assistant') return [];
  const content = message.message?.content;
  if (!Array.isArray(content)) return [];
  return content as ContentBlock[];
}

// Extract Task tool calls (for subagent spawning)
function extractTaskToolCalls(message: any): ToolUseBlock[] {
  const blocks = extractContentBlocks(message);
  return blocks.filter(
    (block): block is ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'Task'
  );
}

// Extract non-Task tool calls
function extractToolCalls(message: any): ToolUseBlock[] {
  const blocks = extractContentBlocks(message);
  return blocks.filter(
    (block): block is ToolUseBlock =>
      block.type === 'tool_use' && block.name !== 'Task'
  );
}

export function ChatInterface() {
  const { user, signOut } = useAuth();

  // Session ID = SDK session ID = DB primary key (all the same)
  // Capture initial value once using a ref
  const initialSessionIdRef = useRef<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  );
  const [sessionId, setSessionId] = useState<string | null>(initialSessionIdRef.current);
  const [isLoadingHistory, setIsLoadingHistory] = useState(!!initialSessionIdRef.current);
  const loadedSessionId = useRef<string | null>(null);
  const sessionCreatedInDb = useRef(false);

  // Timeline-based state
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage>>(new Map());
  const [subagentsMap, setSubagentsMap] = useState<Map<string, Subagent>>(new Map());
  const [addedSubagentIds, setAddedSubagentIds] = useState<Set<string>>(new Set());

  const [isStreaming, setIsStreaming] = useState(false);
  const isSendingRef = useRef(false); // Prevent concurrent sends
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline, messagesMap, subagentsMap]);

  // Save session ID to localStorage when it changes
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(STORAGE_KEY, sessionId);
    }
  }, [sessionId]);

  // Load messages from DB on mount if we have a session ID from localStorage
  useEffect(() => {
    async function loadHistory() {
      // Only load if we have a session ID that we haven't loaded yet
      if (!sessionId || loadedSessionId.current === sessionId) return;

      // If this session ID wasn't in localStorage initially, skip loading
      // (it's a new session being created during this session)
      if (sessionId !== initialSessionIdRef.current) {
        loadedSessionId.current = sessionId;
        setIsLoadingHistory(false);
        return;
      }

      loadedSessionId.current = sessionId;

      try {
        // Check if session exists in DB
        console.log('[LOAD] Checking session:', sessionId);
        const session = await getSession(sessionId);
        if (session) {
          console.log('[LOAD] Session found, loading messages');
          sessionCreatedInDb.current = true;

          // Load messages
          const messages = await getSessionMessages(sessionId);
          console.log('[LOAD] Loaded', messages.length, 'messages from DB');
          if (messages.length > 0) {
            // Reconstruct timeline and messagesMap from DB messages
            const newTimeline: TimelineItem[] = [];
            const newMessagesMap = new Map<string, ChatMessage>();

            messages.forEach((msg) => {
              const id = crypto.randomUUID();
              const chatMessage: ChatMessage = {
                id,
                type: msg.role as 'user' | 'assistant',
                content: msg.content,
                timestamp: new Date(msg.created_at),
              };
              newMessagesMap.set(id, chatMessage);
              newTimeline.push({
                type: 'message',
                id,
                timestamp: new Date(msg.created_at),
              });
            });

            setMessagesMap(newMessagesMap);
            setTimeline(newTimeline);
          }
        }
      } catch (error) {
        console.error('Failed to load history:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    }

    loadHistory();
  }, [sessionId]);

  const handleSend = async (content: string) => {
    // Prevent concurrent sends
    if (isSendingRef.current) {
      console.log('[SEND] Already sending, ignoring duplicate call');
      return;
    }
    isSendingRef.current = true;

    console.log('[SEND] handleSend called with:', content, 'sessionId:', sessionId, 'sessionCreatedInDb:', sessionCreatedInDb.current);

    // Add user message to timeline
    const userMessageId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: userMessageId,
      type: 'user',
      content,
      timestamp: new Date(),
    };

    setMessagesMap((prev) => new Map(prev).set(userMessageId, userMessage));
    setTimeline((prev) => [
      ...prev,
      { type: 'message', id: userMessageId, timestamp: new Date() },
    ]);

    // Add thinking placeholder
    const thinkingId = crypto.randomUUID();
    const thinkingMessage: ChatMessage = {
      id: thinkingId,
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessagesMap((prev) => new Map(prev).set(thinkingId, thinkingMessage));
    setTimeline((prev) => [
      ...prev,
      { type: 'message', id: thinkingId, timestamp: new Date() },
    ]);

    setIsStreaming(true);
    let currentAssistantId = thinkingId;
    let accumulatedContent = '';
    let currentSessionId = sessionId;
    let userMessageSaved = false; // Track if we've saved the user message
    let sessionInitialized = false; // Track if we've initialized the session

    // If we have a session that's in the DB, save user message now
    if (currentSessionId && sessionCreatedInDb.current) {
      console.log('[DB] Saving user message (existing session):', currentSessionId);
      userMessageSaved = true;
      saveMessage(currentSessionId, 'user', content).catch((err) =>
        console.error('Failed to save user message:', err)
      );
    }

    try {
      for await (const message of streamAgentQuery(
        content,
        sessionId || undefined
      )) {
        const parentToolUseId = (message as any).parent_tool_use_id;

        console.log('[STREAM] Message type:', message.type, 'subtype:', (message as any).subtype, 'session_id:', message.session_id, 'parent:', parentToolUseId);

        // Capture session ID from first message and ensure DB session exists
        // Only do this ONCE per query
        if (!sessionInitialized && !sessionId && message.session_id) {
          sessionInitialized = true;
          currentSessionId = message.session_id;
          setSessionId(message.session_id);

          console.log('[DB] Creating new session:', message.session_id);

          // Create DB session with the SDK session ID as primary key
          try {
            await ensureSession(message.session_id);
            sessionCreatedInDb.current = true;

            // Save the user message we just sent
            if (!userMessageSaved) {
              console.log('[DB] Saving user message (new session):', message.session_id);
              userMessageSaved = true;
              await saveMessage(message.session_id, 'user', content);
            }
          } catch (err) {
            console.error('Failed to create DB session:', err);
          }
        }

        // Handle result message for subagent completion
        if (message.type === 'result' && parentToolUseId) {
          setSubagentsMap((prev) => {
            const subagent = prev.get(parentToolUseId);
            if (subagent) {
              const updated = new Map(prev);
              updated.set(parentToolUseId, {
                ...subagent,
                status: 'completed',
                endTime: new Date(),
              });
              return updated;
            }
            return prev;
          });
          continue;
        }

        // Handle subagent messages (don't add to timeline)
        if (parentToolUseId && message.type === 'assistant') {
          const toolCalls = extractToolCalls(message);
          if (toolCalls.length > 0) {
            const subagentToolCalls: SubagentToolCall[] = toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              input: tc.input,
              status: 'completed' as const,
              timestamp: new Date(),
            }));

            setSubagentsMap((prev) => {
              const subagent = prev.get(parentToolUseId);
              if (subagent) {
                const updated = new Map(prev);
                updated.set(parentToolUseId, {
                  ...subagent,
                  toolCalls: [...subagent.toolCalls, ...subagentToolCalls],
                });
                return updated;
              }
              return prev;
            });
          }
          continue;
        }

        // Handle main assistant messages
        if (message.type === 'assistant') {
          const textContent = extractTextContent(message);
          const contentBlocks = extractContentBlocks(message);
          const taskCalls = extractTaskToolCalls(message);

          // Create subagents for Task tool calls
          if (taskCalls.length > 0) {
            const now = new Date();
            const newSubagents: Subagent[] = [];
            const newTimelineItems: TimelineItem[] = [];

            taskCalls.forEach((task, index) => {
              if (!addedSubagentIds.has(task.id)) {
                const subagent: Subagent = {
                  id: task.id,
                  type: task.input.subagent_type || 'unknown',
                  description:
                    task.input.description ||
                    task.input.prompt?.substring(0, 50) ||
                    'Task',
                  status: 'running',
                  startTime: new Date(now.getTime() + index),
                  toolCalls: [],
                };
                newSubagents.push(subagent);
                newTimelineItems.push({
                  type: 'subagent',
                  id: task.id,
                  timestamp: new Date(now.getTime() + index),
                });
              }
            });

            if (newSubagents.length > 0) {
              setSubagentsMap((prev) => {
                const updated = new Map(prev);
                newSubagents.forEach((s) => updated.set(s.id, s));
                return updated;
              });

              setAddedSubagentIds((prev) => {
                const updated = new Set(prev);
                newSubagents.forEach((s) => updated.add(s.id));
                return updated;
              });

              setTimeline((prev) => [...prev, ...newTimelineItems]);
            }
          }

          // Update assistant message
          if (textContent || contentBlocks.length > 0) {
            accumulatedContent += textContent;

            setMessagesMap((prev) => {
              const updated = new Map(prev);
              const existing = prev.get(currentAssistantId);
              if (existing) {
                updated.set(currentAssistantId, {
                  ...existing,
                  content: accumulatedContent,
                  contentBlocks,
                  isStreaming: true,
                });
              }
              return updated;
            });
          }
        }
      }

      // Finalize assistant message
      setMessagesMap((prev) => {
        const updated = new Map(prev);
        const existing = prev.get(currentAssistantId);
        if (existing) {
          updated.set(currentAssistantId, {
            ...existing,
            isStreaming: false,
          });
        }
        return updated;
      });

      // Save assistant message to DB
      if (currentSessionId && sessionCreatedInDb.current && accumulatedContent) {
        console.log('[DB] Saving assistant message, length:', accumulatedContent.length);
        saveMessage(currentSessionId, 'assistant', accumulatedContent).catch((err) =>
          console.error('Failed to save assistant message:', err)
        );
      } else {
        console.log('[DB] NOT saving assistant message:', { currentSessionId, sessionCreatedInDb: sessionCreatedInDb.current, contentLength: accumulatedContent.length });
      }
    } catch (error) {
      console.error('Stream error:', error);
      setMessagesMap((prev) => {
        const updated = new Map(prev);
        updated.set(currentAssistantId, {
          id: currentAssistantId,
          type: 'error',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        });
        return updated;
      });
    } finally {
      setIsStreaming(false);
      isSendingRef.current = false;
    }
  };

  const handleNewChat = () => {
    // Clear localStorage
    localStorage.removeItem(STORAGE_KEY);

    // Reset refs - set initialSessionIdRef to null so new sessions don't try to load history
    initialSessionIdRef.current = null;
    loadedSessionId.current = null;
    sessionCreatedInDb.current = false;
    isSendingRef.current = false;

    // Reset all state
    setSessionId(null);
    setIsLoadingHistory(false);
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Agent Chat</h1>
        <div className="flex items-center gap-4">
          {sessionId && (
            <span className="text-xs text-muted-foreground">
              Session: {sessionId.slice(0, 8)}...
            </span>
          )}
          <button
            onClick={handleNewChat}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            New Chat
          </button>
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <button
            onClick={signOut}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading conversation history...
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {sessionId
              ? 'Session loaded. Send a message to continue.'
              : 'Send a message to start chatting with the agent'}
          </div>
        ) : (
          <MessageList
            timeline={timeline}
            messagesMap={messagesMap}
            subagentsMap={subagentsMap}
          />
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="border-t border-border p-4">
        <MessageInput onSend={handleSend} disabled={isStreaming} />
      </footer>
    </div>
  );
}
