import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSessions } from '@/contexts/SessionContext';
import { useFiles } from '@/contexts/FileContext';
import { useDevMode } from '@/contexts/DevModeContext';
import { streamAgentQuery, getSessionMessages } from '@/lib/api';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { DevModeMessageList } from './DevModeMessageList';
import { deriveUserView, processSubagentMessages } from '@/lib/messageUtils';
import type {
  ChatMessage,
  Subagent,
  SubagentToolCall,
  TimelineItem,
  ContentBlock,
  ToolUseBlock,
  FileEvent,
} from '@/types';

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
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { currentSession, setCurrentSession, updateCurrentSession, loadSessions } = useSessions();
  const { addOrUpdateFile, clearFiles } = useFiles();
  const {
    isDevMode, setDevMode, isAdmin, openSubagentTab,
    rawMessages, setRawMessages, subagentRawMessages, setSubagentRawMessages,
    persistCurrentSession, loadSessionFromStorage, setCurrentSessionId,
    markCurrentSessionComplete, isReconnecting, stopReconnection
  } = useDevMode();

  // Session creation form state (shown when no session)
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [initialMessageInput, setInitialMessageInput] = useState('');

  // Timeline-based state
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage>>(new Map());
  const [subagentsMap, setSubagentsMap] = useState<Map<string, Subagent>>(new Map());
  const [addedSubagentIds, setAddedSubagentIds] = useState<Set<string>>(new Set());

  // Raw messages come from DevModeContext (already destructured above)

  const [isStreaming, setIsStreaming] = useState(false);
  const isSendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track last session ID to detect changes
  const lastSessionIdRef = useRef<string | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline, messagesMap, subagentsMap]);

  // Clear state when switching between different EXISTING sessions (not during creation)
  useEffect(() => {
    const currentId = currentSession?.id || null;
    const previousId = lastSessionIdRef.current;

    // Only clear state when switching between different REAL sessions
    // Don't clear when:
    // - previousId was null (first load or coming from no session)
    // - previousId was 'pending' (transitioning from creation to real ID - same session!)
    // - currentId is 'pending' (starting to create a new session)
    const isRealSessionSwitch =
      previousId !== null &&
      previousId !== 'pending' &&
      currentId !== null &&
      currentId !== 'pending' &&
      currentId !== previousId;

    if (isRealSessionSwitch) {
      setTimeline([]);
      setMessagesMap(new Map());
      setSubagentsMap(new Map());
      setAddedSubagentIds(new Set());
    }

    lastSessionIdRef.current = currentId;
  }, [currentSession?.id]);

  // Update currentSessionId in context when session changes
  useEffect(() => {
    if (currentSession?.id && currentSession.id !== 'pending') {
      setCurrentSessionId(currentSession.id);
    }
  }, [currentSession?.id, setCurrentSessionId]);

  // Derive user view from raw messages (works for both live and history)
  const derivedUserView = useMemo(() => {
    if (rawMessages.length === 0) return null;
    const base = deriveUserView(rawMessages);
    // Process subagent messages to populate tool calls
    const enhancedSubagentsMap = processSubagentMessages(subagentRawMessages, base.subagentsMap);
    return {
      ...base,
      subagentsMap: enhancedSubagentsMap,
    };
  }, [rawMessages, subagentRawMessages]);

  // Persist to localStorage after each SSE message
  // Mark as streaming if currently streaming, so we can detect interrupted sessions
  useEffect(() => {
    if (rawMessages.length > 0 && currentSession?.id && currentSession.id !== 'pending') {
      persistCurrentSession(isStreaming);
    }
  }, [rawMessages, currentSession?.id, persistCurrentSession, isStreaming]);

  // Try to recover session from storage on refresh
  useEffect(() => {
    const loadStoredSession = async () => {
      if (!currentSession || currentSession.id === 'pending') return;
      // Only try to load from storage if we don't have messages yet
      if (timeline.length > 0 || rawMessages.length > 0) return;

      const loaded = await loadSessionFromStorage(currentSession.id);
      if (loaded) {
        console.log('Session recovered from storage');
      }
    };

    loadStoredSession();
  }, [currentSession?.id, timeline.length, rawMessages.length, loadSessionFromStorage]);

  // Load messages from backend as fallback when no rawMessages available
  // This only runs if we couldn't load from localStorage or Supabase Storage
  useEffect(() => {
    const loadMessages = async () => {
      if (!currentSession || currentSession.id === 'pending') return;

      // Don't reload if we already have messages from storage or streaming
      if (timeline.length > 0 || rawMessages.length > 0) return;

      try {
        const messages = await getSessionMessages(currentSession.id);

        const newTimeline: TimelineItem[] = [];
        const newMessagesMap = new Map<string, ChatMessage>();

        messages.forEach((msg) => {
          const chatMessage: ChatMessage = {
            id: msg.id,
            type: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content,
            timestamp: new Date(msg.created_at),
          };
          newMessagesMap.set(msg.id, chatMessage);
          newTimeline.push({
            type: 'message',
            id: msg.id,
            timestamp: new Date(msg.created_at),
          });
        });

        setMessagesMap(newMessagesMap);
        setTimeline(newTimeline);
      } catch (error) {
        console.error('Failed to load session messages:', error);
      }
    };

    loadMessages();
  }, [currentSession?.id, rawMessages.length, timeline.length]);

  // Handle sending a message in an existing session
  const handleSend = async (content: string) => {
    if (!currentSession) return;
    await sendMessage(content, currentSession.session_name, currentSession.sdk_session_id || undefined);
  };

  // Handle creating a new session and sending the first message
  const handleNewSessionSubmit = async () => {
    const name = sessionNameInput.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const message = initialMessageInput.trim();
    if (!name || !message) return;

    // Clear form inputs
    setSessionNameInput('');
    setInitialMessageInput('');

    // Clear any previous state explicitly (not via effect)
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
    setRawMessages([]);
    setSubagentRawMessages(new Map());
    clearFiles();

    // Set temporary session BEFORE sending - this ensures UI shows chat view
    setCurrentSession({
      id: 'pending',
      user_id: user?.id || '',
      title: name,
      session_name: name,
      file_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Small delay to ensure React has processed the state update
    await new Promise(resolve => setTimeout(resolve, 0));

    // Send the initial message
    await sendMessage(message, name, undefined);
  };

  const sendMessage = async (content: string, sessionName: string, existingSdkSessionId?: string) => {
    if (isSendingRef.current || !sessionName) return;
    isSendingRef.current = true;

    // Stop any active reconnection - user is sending new message
    stopReconnection();

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
        // Always collect raw messages (for dev mode display, even if currently in user mode)
        // This ensures toggling modes doesn't lose message history
        {
          const parentToolUseId = (message as any).parent_tool_use_id;
          if (parentToolUseId) {
            // Subagent message
            setSubagentRawMessages(prev => {
              const updated = new Map(prev);
              const existing = updated.get(parentToolUseId) || [];
              updated.set(parentToolUseId, [...existing, message]);
              return updated;
            });
          } else {
            // Main agent message
            setRawMessages(prev => [...prev, message]);
          }
        }

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
            // Navigate to session URL (use sessionName parameter, not stale closure)
            navigate(`/${sessionName}`, { replace: true });
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
      // Mark session as complete in localStorage so we don't poll on next refresh
      markCurrentSessionComplete();
    }
  };

  // Handle "New Chat" button - clears current session to show create form
  const handleNewChat = () => {
    stopReconnection(); // Stop any active reconnection
    setCurrentSession(null);
    clearFiles();
    setTimeline([]);
    setMessagesMap(new Map());
    setSubagentsMap(new Map());
    setAddedSubagentIds(new Set());
    setRawMessages([]);
    setSubagentRawMessages(new Map());
    setSessionNameInput('');
    setInitialMessageInput('');
  };

  // Render the inline session creation form
  const renderSessionCreationForm = () => (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="w-full max-w-xl">
        <h2 className="text-2xl font-semibold text-center mb-2">Start a New Session</h2>
        <p className="text-muted-foreground text-center mb-8">
          Name your session and describe what you want the agent to do.
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Session Name</label>
            <input
              type="text"
              value={sessionNameInput}
              onChange={(e) => setSessionNameInput(e.target.value)}
              placeholder="e.g., nba_research, project_alpha"
              className="w-full bg-input border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-2">
              Letters, numbers, underscores, and hyphens only
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">What would you like the agent to do?</label>
            <textarea
              value={initialMessageInput}
              onChange={(e) => setInitialMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) {
                  handleNewSessionSubmit();
                }
              }}
              placeholder="e.g., Search for NBA news and write a summary report..."
              rows={5}
              className="w-full bg-input border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <button
            onClick={handleNewSessionSubmit}
            disabled={!sessionNameInput.trim() || !initialMessageInput.trim()}
            className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Start Session
          </button>

          <p className="text-xs text-muted-foreground text-center">
            Cmd + Enter to submit
          </p>
        </div>
      </div>
    </div>
  );

  // Use derived view when available (from rawMessages), otherwise use live state
  const displayTimeline = derivedUserView?.timeline ?? timeline;
  const displayMessagesMap = derivedUserView?.messagesMap ?? messagesMap;
  const displaySubagentsMap = derivedUserView?.subagentsMap ?? subagentsMap;

  // Render the chat view (when session exists)
  const renderChatView = () => (
    <>
      {/* Recovery Banner - shown when reconnecting to server stream */}
      {isReconnecting && (
        <div className="bg-blue-500/10 border-b border-blue-500/30 px-4 py-2 flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
          <span className="text-blue-400 text-sm">
            Reconnecting to server stream...
          </span>
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4">
        {isDevMode ? (
          <DevModeMessageList
            messages={rawMessages}
            onSubagentClick={openSubagentTab}
          />
        ) : (
          <MessageList
            timeline={displayTimeline}
            messagesMap={displayMessagesMap}
            subagentsMap={displaySubagentsMap}
          />
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="border-t border-border p-4 flex-shrink-0">
        <MessageInput onSend={handleSend} disabled={isStreaming} />
      </footer>
    </>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3 flex-shrink-0">
        <h1 className="text-lg font-semibold">Agent Chat</h1>
        <div className="flex items-center gap-4">
          {/* Dev Mode Toggle - Admin Only */}
          {isAdmin && (
            <button
              onClick={() => setDevMode(!isDevMode)}
              className={`text-xs px-2 py-1 rounded ${
                isDevMode
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                  : 'bg-card text-muted-foreground border border-border'
              }`}
            >
              {isDevMode ? 'Dev Mode' : 'User Mode'}
            </button>
          )}
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

      {/* Main content - either session creation form or chat */}
      {currentSession ? renderChatView() : renderSessionCreationForm()}
    </div>
  );
}
