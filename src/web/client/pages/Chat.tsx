import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Send, Loader2, Bot, User, Wrench, ChevronDown, ChevronUp, MessageSquare, Trash2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: any[];
  timestamp?: string;
}

interface Session {
  id: string;
  channel: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch sessions list
  const { data: sessionsData } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: async () => {
      const response = await fetch('/api/chat/sessions');
      return response.json();
    },
  });

  // Load session history when session is selected
  const { data: sessionHistory, isLoading: isLoadingHistory } = useQuery({
    queryKey: ['session-history', currentSessionId],
    queryFn: async () => {
      if (!currentSessionId) return null;
      console.log('[Chat] Loading history for session:', currentSessionId);
      const response = await fetch(`/api/chat/sessions/${currentSessionId}`);
      const data = await response.json();
      console.log('[Chat] History loaded:', data);
      return data;
    },
    enabled: !!currentSessionId,
  });

  // Update messages when session history loads
  useEffect(() => {
    console.log('[Chat] Session history effect:', { hasHistory: !!sessionHistory, isLoading: isLoadingHistory });
    if (sessionHistory?.session?.messages) {
      console.log('[Chat] Setting messages from history, count:', sessionHistory.session.messages.length);
      setMessages(sessionHistory.session.messages);
    }
  }, [sessionHistory, isLoadingHistory]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
      if (currentSessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    },
  });

  // Send message with SSE streaming
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          sessionId: currentSessionId,
          channel: 'web',
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No reader available');

      let assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[Chat] Stream done');
          break;
        }

        const chunk = decoder.decode(value);
        console.log('[Chat] Received chunk:', chunk);
        const lines = chunk.split('\n');

        for (const line of lines) {
          // Parse SSE event type
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            console.log('[Chat] Event type:', currentEvent);
            continue;
          }

          // Parse SSE data
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (!data.trim()) continue;

            try {
              const parsed = JSON.parse(data);
              console.log('[Chat] Parsed data:', parsed, 'for event:', currentEvent);

              if (currentEvent === 'session') {
                console.log('[Chat] Setting session ID:', parsed.sessionId);
                setCurrentSessionId(parsed.sessionId);
                // Immediately refresh sessions list when a new session is created
                queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
              } else if (currentEvent === 'tool_calls') {
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.toolCalls = parsed.toolCalls;
                  }
                  return updated;
                });
              } else if (currentEvent === 'chunk') {
                console.log('[Chat] Updating message with chunk:', parsed.chunk);
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.content = parsed.chunk;
                  }
                  return updated;
                });
              } else if (currentEvent === 'done') {
                console.log('[Chat] Done event received');
                queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
              } else if (currentEvent === 'error') {
                console.error('[Chat] Stream error:', parsed);
              }
            } catch (e) {
              console.error('[Chat] Failed to parse JSON:', data, e);
            }

            currentEvent = ''; // Reset event type after processing
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsStreaming(false);
    }
  };

  const toggleToolCall = (index: number) => {
    setExpandedToolCalls(prev => {
      const updated = new Set(prev);
      if (updated.has(index)) {
        updated.delete(index);
      } else {
        updated.add(index);
      }
      return updated;
    });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sessions Sidebar */}
      <div className="w-64 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900">Sessions</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessionsData?.sessions?.map((session: Session) => (
            <div
              key={session.id}
              className={`p-3 border-b cursor-pointer hover:bg-gray-100 flex items-start justify-between group ${
                currentSessionId === session.id ? 'bg-blue-50' : ''
              }`}
              onClick={() => setCurrentSessionId(session.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {session.id}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {session.messageCount} messages • {new Date(session.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Delete this session?')) {
                    deleteSessionMutation.mutate(session.id);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t">
          <button
            onClick={() => {
              setCurrentSessionId(null);
              setMessages([]);
            }}
            className="w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            New Chat
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Bot className="w-16 h-16 mb-4 text-gray-300" />
              <p className="text-lg">Start a conversation</p>
              <p className="text-sm mt-1">Ask me anything about Beeclaw</p>
            </div>
          )}

          {messages.map((message, index) => {
            // Skip empty assistant messages while streaming (show loading indicator instead)
            if (message.role === 'assistant' && !message.content && isStreaming) {
              return null;
            }

            return (
              <div
                key={index}
                className={`flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              )}

              <div
                className={`max-w-2xl ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-2'
                    : 'bg-white border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm'
                }`}
              >
                {message.role === 'user' ? (
                  <p>{message.content}</p>
                ) : (
                  <>
                    <ReactMarkdown
                      className="prose prose-sm max-w-none"
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-2 list-decimal pl-4">{children}</ol>,
                        code: ({ className, children }) => {
                          const isInline = !className;
                          return isInline ? (
                            <code className="bg-gray-100 px-1 py-0.5 rounded text-sm">{children}</code>
                          ) : (
                            <code className="block bg-gray-100 p-2 rounded text-sm overflow-x-auto">{children}</code>
                          );
                        },
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>

                    {/* Tool Calls */}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {message.toolCalls.map((toolCall, tcIndex) => (
                          <div key={tcIndex} className="border rounded overflow-hidden">
                            <button
                              onClick={() => toggleToolCall(tcIndex)}
                              className="w-full px-3 py-2 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-sm"
                            >
                              <div className="flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-orange-500" />
                                <span className="font-medium">{toolCall.function?.name || 'Tool'}</span>
                              </div>
                              {expandedToolCalls.has(tcIndex) ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                            {expandedToolCalls.has(tcIndex) && (
                              <div className="p-3 bg-gray-50 border-t text-xs font-mono">
                                <div className="mb-2">
                                  <span className="text-gray-500">Arguments:</span>
                                  <pre className="mt-1 whitespace-pre-wrap">
                                    {JSON.stringify(toolCall.function?.arguments, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {message.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                  <User className="w-5 h-5 text-gray-600" />
                </div>
              )}
            </div>
          );
        })}

          {isStreaming && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-white border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t p-4 bg-white">
          <form onSubmit={sendMessage} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isStreaming}
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
