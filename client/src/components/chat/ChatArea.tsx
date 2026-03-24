import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, CheckCircle, ArrowRight, Sparkles, MessageSquare, X, UserRoundPlus, Lock, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { getSocket, joinConversation, leaveConversation, emitTyping } from '../../lib/socket';

interface Message {
  _id: string;
  content: string;
  senderRole: string;
  sender?: { _id: string; name: string };
  analysis?: {
    intent?: string;
    priority?: string;
    sentiment?: string;
  };
  createdAt: string;
}

interface AiAssistData {
  summary: string;
  suggestedReply: string;
}

export default function ChatArea() {
  const { activeConversationId, setActiveConversation, typingUsers, setTyping, clearTyping } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevConvRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [showAssist, setShowAssist] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fetch messages
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', activeConversationId],
    queryFn: async () => {
      const res = await api.get(`/api/conversations/${activeConversationId}/messages`, {
        params: { page: 1, limit: 100 },
      });
      return res.data.data;
    },
    enabled: !!activeConversationId,
  });

  const messages: Message[] = messagesData?.data || messagesData || [];

  // Fetch conversation details
  const { data: convData } = useQuery({
    queryKey: ['conversation', activeConversationId],
    queryFn: async () => {
      const res = await api.get(`/api/conversations/${activeConversationId}`);
      return res.data.data;
    },
    enabled: !!activeConversationId,
  });

  // Fetch AI assistance (agent only)
  const { data: assistData, refetch: refetchAssist } = useQuery<AiAssistData>({
    queryKey: ['ai-assist', activeConversationId],
    queryFn: async () => {
      const res = await api.get(`/api/conversations/${activeConversationId}/messages/ai-assist`);
      return res.data.data;
    },
    enabled: !!activeConversationId && user?.role === 'agent' && showAssist,
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post(`/api/conversations/${activeConversationId}/messages`, { content });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', activeConversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Resolve mutation (agent or patient)
  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch(`/api/conversations/${activeConversationId}/resolve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation', activeConversationId] });
      if (user?.role === 'patient') {
        setActiveConversation(null);
      }
    },
  });

  // Escalate AI → Human mutation (patient only)
  const escalateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch(`/api/conversations/${activeConversationId}/escalate`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation', activeConversationId] });
    },
  });

  // WebSocket: join/leave rooms + listen for events
  useEffect(() => {
    if (!activeConversationId) return;

    // Leave previous room
    if (prevConvRef.current && prevConvRef.current !== activeConversationId) {
      leaveConversation(prevConvRef.current);
    }

    joinConversation(activeConversationId);
    prevConvRef.current = activeConversationId;

    const socket = getSocket();
    const userId = user?._id;

    const handleNewMessage = (data: any) => {
      if (data.conversationId === activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ['messages', activeConversationId] });
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const handleAiComplete = (data: any) => {
      if (data.conversationId === activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ['messages', activeConversationId] });
      }
    };

    // Refresh conversation status in real-time when assigned
    const handleConversationAssigned = (data: any) => {
      if (data.conversationId === activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversation', activeConversationId] });
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    // Refresh and auto-close (for patients) when resolved
    const handleConversationResolved = (data: any) => {
      if (data.conversationId === activeConversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversation', activeConversationId] });
        if (userId && user?.role === 'patient') {
          setActiveConversation(null);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const handleTypingEvent = (data: any) => {
      if (data.conversationId === activeConversationId && data.userId !== userId) {
        setTyping(data.userId, true);
        setTimeout(() => clearTyping(data.userId), 3000);
      }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('message:ai:complete', handleAiComplete);
    socket.on('conversation:resolved', handleConversationResolved);
    socket.on('conversation:assigned', handleConversationAssigned);
    socket.on('conversation:escalated', handleConversationAssigned); // reuse — refreshes queries
    socket.on('agent:typing', handleTypingEvent);
    socket.on('patient:typing', handleTypingEvent);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:ai:complete', handleAiComplete);
      socket.off('conversation:resolved', handleConversationResolved);
      socket.off('conversation:assigned', handleConversationAssigned);
      socket.off('conversation:escalated', handleConversationAssigned);
      socket.off('agent:typing', handleTypingEvent);
      socket.off('patient:typing', handleTypingEvent);
    };
  }, [activeConversationId, queryClient, user?._id, setTyping, clearTyping]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle send
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Typing indicator emit
  const handleInputChange = (value: string) => {
    setInput(value);
    if (activeConversationId) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      emitTyping(activeConversationId);
      typingTimeoutRef.current = setTimeout(() => {}, 2000);
    }
  };

  // Auto-resize textarea
  const handleTextareaResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    handleInputChange(el.value);
  };

  const useSuggestion = () => {
    if (assistData?.suggestedReply) {
      setInput(assistData.suggestedReply);
      textareaRef.current?.focus();
    }
  };

  const formatTime = (date: string) =>
    new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const getInitials = (name?: string) =>
    name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  const isTyping = Object.values(typingUsers).some(Boolean);

  // Empty state
  if (!activeConversationId) {
    return (
      <div className="chat-panel">
        <div className="chat-empty">
          <div className="chat-empty-icon">
            <MessageSquare size={28} />
          </div>
          <h3>Select a conversation</h3>
          <p>Choose a conversation from the list to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="conv-avatar">
            {getInitials(convData?.patient?.name)}
          </div>
          <div>
            <h3>{convData?.patient?.name || 'Conversation'}</h3>
            <span>
              <span className={`channel-badge ${convData?.channel}`}>{convData?.channel}</span>
              {' '}
              <span className={`status-badge ${convData?.status}`}>{convData?.status?.replace('_', ' ')}</span>
            </span>
          </div>
        </div>
        <div className="chat-actions">
          {user?.role === 'agent' && (
            <>
              <button
                className="chat-action-btn"
                onClick={() => { setShowAssist(!showAssist); if (!showAssist) refetchAssist(); }}
                title="AI Assistant"
                style={showAssist ? { color: 'var(--violet)', background: 'rgba(139,92,246,0.1)' } : {}}
              >
                <Sparkles size={18} />
              </button>
            </>
          )}
          {user?.role === 'patient' && convData?.channel === 'ai' && convData?.status !== 'resolved' && (
            <button
              className="chat-action-btn"
              onClick={() => escalateMutation.mutate()}
              title="Transfer to Human Agent"
              disabled={escalateMutation.isPending}
              style={{ color: 'var(--teal)' }}
            >
              <UserRoundPlus size={18} />
            </button>
          )}
          {convData?.status !== 'resolved' && (
            <button
              className="chat-action-btn"
              onClick={() => resolveMutation.mutate()}
              title={user?.role === 'agent' ? 'Resolve' : 'Close Conversation'}
              disabled={resolveMutation.isPending}
            >
              <CheckCircle size={18} />
            </button>
          )}
          <button
            className="chat-action-btn"
            onClick={() => setActiveConversation(null)}
            title="Close View"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* AI Assist Bar */}
      <AnimatePresence>
        {showAssist && user?.role === 'agent' && assistData && (
          <motion.div
            className="ai-assist-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="ai-assist-header">
              <div className="ai-assist-label">
                <Sparkles size={14} /> AI Assistant
              </div>
            </div>
            <div className="ai-assist-content">
              {assistData.summary && (
                <div className="ai-assist-summary">
                  <strong>Summary:</strong> {assistData.summary}
                </div>
              )}
              {assistData.suggestedReply && (
                <div className="ai-assist-suggestion">
                  <strong>Suggested:</strong> {assistData.suggestedReply}
                </div>
              )}
              <div className="ai-assist-actions">
                <button className="ai-assist-btn primary" onClick={useSuggestion}>
                  <ArrowRight size={12} /> Use Suggestion
                </button>
                <button className="ai-assist-btn ghost" onClick={() => refetchAssist()}>
                  Refresh
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="chat-messages">
        {messagesLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`chat-bubble-wrapper ${i % 2 === 0 ? 'patient' : 'agent'}`}>
              <div className="skeleton" style={{ width: 28, height: 28, borderRadius: '50%' }} />
              <div>
                <div className="skeleton" style={{ width: 200 + Math.random() * 100, height: 40, borderRadius: 12 }} />
              </div>
            </div>
          ))
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg._id}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={`chat-bubble-wrapper ${msg.senderRole}`}
              >
                <div className={`chat-bubble-avatar ${msg.senderRole}`}>
                  {msg.senderRole === 'ai' ? 'AI' : getInitials(msg.sender?.name)}
                </div>
                <div>
                  <div className={`chat-bubble ${msg.senderRole}`}>
                    {msg.content}
                  </div>
                  <div className="chat-bubble-time">{formatTime(msg.createdAt)}</div>
                  {msg.analysis && msg.senderRole === 'patient' && (
                    <div className="analysis-tags">
                      {msg.analysis.intent && (
                        <span className="analysis-tag intent">{msg.analysis.intent}</span>
                      )}
                      {msg.analysis.priority && (
                        <span className="analysis-tag priority">{msg.analysis.priority}</span>
                      )}
                      {msg.analysis.sentiment && (
                        <span className="analysis-tag sentiment">{msg.analysis.sentiment}</span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {isTyping && (
          <div className="typing-indicator">
            <div className="typing-dots">
              <span /><span /><span />
            </div>
            Someone is typing…
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer or Status Banner */}
      {(() => {
        const isResolved = convData?.status === 'resolved';
        const isAgent = user?.role === 'agent';
        const isAssignedToMe = convData?.agent?._id === user?._id;
        const isAssignedToOther = isAgent && convData?.agent && !isAssignedToMe;
        const isPending = convData?.status === 'pending';
        const canReply = !isResolved && (!isAgent || isAssignedToMe || (!convData?.agent && !isPending));

        if (isResolved) {
          return (
            <div className="chat-status-banner resolved">
              <CheckCircle size={16} />
              <span>This conversation has been resolved</span>
              {convData?.resolvedAt && (
                <span className="banner-time">{new Date(convData.resolvedAt).toLocaleString()}</span>
              )}
            </div>
          );
        }

        if (isAssignedToOther) {
          return (
            <div className="chat-status-banner locked">
              <Lock size={16} />
              <span>This conversation is handled by <strong>{convData?.agent?.name || 'another agent'}</strong></span>
            </div>
          );
        }

        if (isAgent && isPending) {
          return (
            <div className="chat-status-banner pending">
              <AlertTriangle size={16} />
              <span>This conversation is not yet assigned</span>
            </div>
          );
        }

        return (
          <div className="msg-composer">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Type a message… (Enter to send)"
              value={input}
              onChange={handleTextareaResize}
              onKeyDown={handleKeyDown}
              disabled={!canReply}
            />
            <button
              className="msg-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending || !canReply}
            >
              <Send size={18} />
            </button>
          </div>
        );
      })()}
    </div>
  );
}
