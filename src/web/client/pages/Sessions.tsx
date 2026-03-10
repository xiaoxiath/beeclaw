import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  Calendar,
  Clock,
  ChevronRight,
  Loader2,
  Activity,
  Network,
  MessageCircle,
} from 'lucide-react';
import DAGViewer from '../components/dag/DAGViewer';

interface Session {
  id: string;
  channel: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

interface SessionDetail {
  session: {
    id: string;
    channel: string;
    messages: any[];
    createdAt: string;
    updatedAt: string;
    summary?: string;
  };
}

export default function Sessions() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'messages' | 'dag'>('messages');

  // Fetch sessions list
  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error('Failed to fetch sessions');
      return response.json();
    },
  });

  // Fetch selected session details (only when viewing messages)
  const { data: sessionDetail, isLoading: isLoadingDetail } = useQuery<SessionDetail>({
    queryKey: ['session-detail', selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return null;
      const response = await fetch(`/api/sessions/${selectedSessionId}`);
      if (!response.ok) throw new Error('Failed to fetch session details');
      return response.json();
    },
    enabled: !!selectedSessionId && viewMode === 'messages',
  });

  // Fetch DAG data for selected session
  const { data: dagData, isLoading: isLoadingDAG } = useQuery({
    queryKey: ['session-dag', selectedSessionId],
    queryFn: async () => {
      console.log('[Sessions] Fetching DAG for session:', selectedSessionId);
      if (!selectedSessionId) return null;
      const response = await fetch(`/api/sessions/${selectedSessionId}/dag`);
      if (!response.ok) throw new Error('Failed to fetch DAG data');
      const data = await response.json();
      console.log('[Sessions] DAG data received:', {
        sessionId: data.sessionId,
        nodesCount: data.nodes?.length || 0,
        edgesCount: data.edges?.length || 0,
      });
      return data;
    },
    enabled: !!selectedSessionId && viewMode === 'dag',
    // Don't cache DAG data to avoid stale state issues
    staleTime: 0,
    gcTime: 0,
  });

  // Force DAG viewer to remount on every session change
  // Use selectedSessionId as part of key to ensure complete remount
  const dagKey = useMemo(() => {
    const key = `dag-${selectedSessionId || 'none'}`;
    console.log('[Sessions] Generated DAG key:', key);
    return key;
  }, [selectedSessionId]);

  console.log('[Sessions] Current DAG state:', {
    selectedSessionId,
    viewMode,
    isLoadingDAG,
    dagDataExists: !!dagData,
    dagNodesCount: dagData?.nodes?.length || 0,
    dagEdgesCount: dagData?.edges?.length || 0,
    dagKey,
  });

  const sessions: Session[] = sessionsData?.sessions || [];

  return (
    <div className="flex h-full -m-6">
      {/* Sidebar - Sessions List */}
      <div className="w-80 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Session History
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {sessionsData?.total || 0} sessions
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No sessions yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  className={`w-full p-4 text-left hover:bg-gray-100 transition ${
                    selectedSessionId === session.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <MessageSquare className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {session.id}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(session.createdAt).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(session.createdAt).toLocaleTimeString()}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded">
                      {session.channel}
                    </span>
                    <span className="text-xs text-gray-500">
                      {session.messageCount} messages
                    </span>
                  </div>

                  {session.summary && (
                    <p className="mt-2 text-xs text-gray-600 line-clamp-2">
                      {session.summary}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content Area - Session Details */}
      <div className="flex-1 flex flex-col">
        {!selectedSessionId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <Activity className="w-16 h-16 mb-4 text-gray-300" />
            <p className="text-lg">Select a session</p>
            <p className="text-sm mt-1">View session details and message history</p>
          </div>
        ) : isLoadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : sessionDetail ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto">
              {/* Session Header */}
              <div className="bg-white border rounded-lg shadow-sm mb-6">
                <div className="px-6 py-4 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {sessionDetail.session.id}
                      </h2>
                      <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                        <span className="px-2 py-1 bg-gray-100 rounded">
                          {sessionDetail.session.channel}
                        </span>
                        <span>{sessionDetail.session.messages.length} messages</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* View Mode Toggle */}
                      <div className="flex items-center gap-1 border rounded p-0.5">
                        <button
                          onClick={() => setViewMode('messages')}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
                            viewMode === 'messages' ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                          }`}
                        >
                          <MessageCircle className="w-4 h-4" />
                          Messages
                        </button>
                        <button
                          onClick={() => setViewMode('dag')}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
                            viewMode === 'dag' ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                          }`}
                        >
                          <Network className="w-4 h-4" />
                          DAG
                        </button>
                      </div>

                      <div className="text-right text-sm text-gray-500">
                        <div className="flex items-center gap-1 mb-1">
                          <Calendar className="w-3 h-3" />
                          Created: {new Date(sessionDetail.session.createdAt).toLocaleString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Updated: {new Date(sessionDetail.session.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content - Messages or DAG */}
                {viewMode === 'dag' ? (
                  // DAG View
                  <div className="min-h-[500px] h-[calc(100vh-20rem)] border rounded relative">
                    {isLoadingDAG ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                      </div>
                    ) : dagData && dagData.nodes && dagData.nodes.length > 0 ? (
                      <>
                        <DAGViewer
                          key={dagKey}
                          nodes={dagData.nodes}
                          edges={dagData.edges}
                        />
                        {/* Zoom hint */}
                        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-md px-3 py-1.5 text-xs text-gray-600 pointer-events-none z-10">
                          💡 使用鼠标滚轮或右下角按钮缩放，拖拽移动
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <Network className="w-16 h-16 mb-4 text-gray-300" />
                        <p className="text-lg">No DAG data available</p>
                        <p className="text-sm mt-1">This session has no tool executions</p>
                      </div>
                    )}
                  </div>
                ) : (
                  // Message List
                  <div className="divide-y">
                    {sessionDetail.session.messages.map((message, index) => (
                      <div key={index} className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              message.role === 'user'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {message.role}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
                              {message.content}
                            </p>
                            {message.timestamp && (
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(message.timestamp).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
