import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSessions } from '@/contexts/SessionContext';
import { useFiles } from '@/contexts/FileContext';
import { streamAgentQuery } from '@/lib/api';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type {
  ChatMessage,
  Subagent,
  SubagentToolCall,
  TimelineItem,
  ContentBlock,
  ToolUseBlock,
  FileEvent,
} from '@/types';

interface ChatInterfaceProps {
  showNewSessionModal: boolean;
  onModalClose: () => void;
  onNewSession: () => void;
}

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

export function ChatInterface({ showNewSessionModal, onModalClose, onNewSession }: ChatInterfaceProps) {
  const { user, signOut } = useAuth();
  const { currentSession, setCurrentSession, updateCurrentSession, loadSessions } = useSessions();
  const { addOrUpdateFile, clearFiles } = useFiles();

  // Session input state
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [initialMessageInput, setInitialMessageInput] = useState('');

  // Timeline-based state
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage>>(new Map());
  const [subagentsMap, setSubagentsMap] = useState<Map<string, Subagent>>(new Map());
  const [addedSubagentIds, setAddedSubagentIds] = useState<Set<string>>(new Set());

  const [isStreaming, setIsStreaming] = useState(false);
  const isSendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline, messagesMap, subagentsMap]);

  // Clear state when session changes
  useEffect(() => {
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
  }, [currentSession?.id]);

  const handleSend = async (content: string) => {
    if (!currentSession) return;
    await sendMessage(content, currentSession.session_name, currentSession.sdk_session_id || undefined);
  };

  const handleNewSessionSubmit = async () => {
    const name = sessionNameInput.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const message = initialMessageInput.trim();
    if (!name || !message) return;

    // Reset modal state
    setSessionNameInput('');
    setInitialMessageInput('');
    onModalClose();

    // Clear previous session state
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
    clearFiles();

    // Set a temporary session (will be updated with real ID after first message)
    setCurrentSession({
      id: 'pending',
      user_id: user?.id || '',
      title: name,
      session_name: name,
      file_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Send the initial message (no existing SDK session ID for new session)
    await sendMessage(message, name, undefined);
  };

  const sendMessage = async (content: string, sessionName: string, existingSdkSessionId?: string) => {
    if (isSendingRef.current || !sessionName) return;
    isSendingRef.current = true;

    console.log('[SEND] Sending message with session:', sessionName, 'sdkSessionId:', existingSdkSessionId || 'new');

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

    try {
      for await (const message of streamAgentQuery(content, sessionName, existingSdkSessionId)) {
        const parentToolUseId = (message as any).parent_tool_use_id;

        // Capture SDK session ID from init message
        if (message.type === 'system' && (message as any).subtype === 'init') {
          const newSessionId = message.session_id;
          if (newSessionId) {
            console.log('[SDK] Got session ID:', newSessionId);
            // Update the current session with real data
            updateCurrentSession({
              id: newSessionId,
              sdk_session_id: newSessionId,
            });
            // Reload sessions list to show the new session
            loadSessions();
          }
        }

        // Handle file events
        if (message.type === 'file_event') {
          const fileEvent = message as FileEvent;
          console.log('[FILE]', fileEvent.subtype, fileEvent.file?.filePath);
          if (fileEvent.file) {
            addOrUpdateFile(fileEvent.file);
            // Update file count in current session
            updateCurrentSession({
              file_count: (currentSession?.file_count || 0) + 1,
            });
          }
          continue;
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

        // Handle subagent messages
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
    setCurrentSession(null);
    clearFiles();
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
    setSessionNameInput('');
    setInitialMessageInput('');
    onNewSession();
  };

  return (
    <div className="flex flex-col h-full">
      {/* New Session Modal */}
      {showNewSessionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg mx-4">
            <h2 className="text-lg font-semibold mb-4">Start New Session</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Session Name</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Letters, numbers, underscores, and hyphens only
                </p>
                <input
                  type="text"
                  value={sessionNameInput}
                  onChange={(e) => setSessionNameInput(e.target.value)}
                  placeholder="e.g., nba_research, project_alpha"
                  className="w-full bg-input border border-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Initial Message</label>
                <p className="text-xs text-muted-foreground mb-2">
                  What would you like the agent to do?
                </p>
                <textarea
                  value={initialMessageInput}
                  onChange={(e) => setInitialMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      handleNewSessionSubmit();
                    }
                  }}
                  placeholder="e.g., Search for NBA news and write a summary..."
                  rows={4}
                  className="w-full bg-input border border-border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={onModalClose}
                className="flex-1 px-4 py-2 border border-border rounded hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleNewSessionSubmit}
                disabled={!sessionNameInput.trim() || !initialMessageInput.trim()}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                Start Session
              </button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-3">
              Cmd + Enter to submit
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3 flex-shrink-0">
        <h1 className="text-lg font-semibold">Agent Chat</h1>
        <div className="flex items-center gap-4">
          {currentSession && (
            <span className="text-xs text-muted-foreground font-mono">
              Session: {currentSession.session_name}
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
        {timeline.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {currentSession
              ? `Session "${currentSession.session_name}" ready. Send a message to continue.`
              : 'Select a session or start a new one'}
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
      <footer className="border-t border-border p-4 flex-shrink-0">
        <MessageInput onSend={handleSend} disabled={isStreaming || !currentSession} />
      </footer>
    </div>
  );
}
