import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Clock, User as UserIcon } from 'lucide-react';
import api from '../../lib/api';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { getSocket } from '../../lib/socket';

interface Conversation {
  _id: string;
  patient: { _id: string; name: string; email: string };
  agent?: { _id: string; name: string };
  channel: string;
  status: string;
  priority?: string;
  category?: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Role-aware tab definitions ──────────────────────────────────
const AGENT_TABS = [
  { label: 'Queue', value: 'queue' },
  { label: 'Mine', value: 'mine' },
  { label: 'Resolved', value: 'resolved' },
];

const PATIENT_TABS = [
  { label: 'Active', value: 'active' },
  { label: 'Resolved', value: 'resolved' },
];

export default function ConversationList() {
  const { activeConversationId, setActiveConversation, statusFilter, setStatusFilter } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const userId = user?._id;
  const isAgent = user?.role === 'agent';
  const queryClient = useQueryClient();

  // Set default tab based on role (once on mount)
  useEffect(() => {
    if (isAgent && statusFilter === 'all') {
      setStatusFilter('queue');
    } else if (!isAgent && statusFilter === 'all') {
      setStatusFilter('active');
    }
  }, [isAgent, statusFilter, setStatusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', userId, statusFilter],
    queryFn: async () => {
      const res = await api.get('/api/conversations', {
        params: { page: 1, limit: 50 },
      });
      return res.data.data;
    },
    refetchInterval: 15_000,
  });

  // Real-time list refresh on any conversation status change
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
    };
    socket.on('conversation:resolved', refresh);
    socket.on('conversation:assigned', refresh);
    socket.on('conversation:escalated', refresh);
    socket.on('conversation:new', refresh);
    socket.on('message:new', refresh);
    return () => {
      socket.off('conversation:resolved', refresh);
      socket.off('conversation:assigned', refresh);
      socket.off('conversation:escalated', refresh);
      socket.off('conversation:new', refresh);
      socket.off('message:new', refresh);
    };
  }, [queryClient, userId]);

  // Auto-assign mutation (agent clicks a pending conversation)
  const assignMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await api.patch(`/api/conversations/${conversationId}/assign`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
    },
  });

  const conversations: Conversation[] = data?.data || data || [];

  // ── Filtered + counted views ──────────────────────────────────
  const counts = useMemo(() => {
    if (isAgent) {
      return {
        queue: conversations.filter((c) => c.status === 'pending').length,
        mine: conversations.filter(
          (c) =>
            c.agent?._id === userId &&
            ['assigned', 'in_progress'].includes(c.status),
        ).length,
        resolved: conversations.filter((c) => c.status === 'resolved').length,
      };
    }
    return {
      active: conversations.filter((c) => c.status !== 'resolved').length,
      resolved: conversations.filter((c) => c.status === 'resolved').length,
    };
  }, [conversations, isAgent, userId]);

  const filtered = useMemo(() => {
    if (isAgent) {
      switch (statusFilter) {
        case 'queue':
          return conversations.filter((c) => c.status === 'pending');
        case 'mine':
          return conversations.filter(
            (c) =>
              c.agent?._id === userId &&
              ['assigned', 'in_progress'].includes(c.status),
          );
        case 'resolved':
          return conversations.filter((c) => c.status === 'resolved');
        default:
          return conversations;
      }
    }
    // Patient
    if (statusFilter === 'resolved') {
      return conversations.filter((c) => c.status === 'resolved');
    }
    return conversations.filter((c) => c.status !== 'resolved');
  }, [conversations, statusFilter, isAgent, userId]);

  // ── Handle conversation click ─────────────────────────────────
  const handleConversationClick = (conv: Conversation) => {
    // Agent clicking a PENDING conversation → auto-assign
    if (isAgent && conv.status === 'pending') {
      assignMutation.mutate(conv._id);
    }
    setActiveConversation(conv._id);
  };

  const tabs = isAgent ? AGENT_TABS : PATIENT_TABS;

  const getInitials = (name?: string) =>
    name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?';

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const getStatusLabel = (conv: Conversation) => {
    if (isAgent && conv.agent && conv.agent._id !== userId) {
      return `Assigned to ${conv.agent.name || 'Agent'}`;
    }
    return conv.status.replace('_', ' ');
  };

  return (
    <div className="conv-panel">
      <div className="conv-header">
        <h2>{isAgent ? 'Support Queue' : 'Conversations'}</h2>
        <div className="conv-filters">
          {tabs.map((tab) => {
            const count = (counts as unknown as Record<string, number>)[tab.value] ?? 0;
            return (
              <button
                key={tab.value}
                className={`conv-filter-chip ${statusFilter === tab.value ? 'active' : ''}`}
                onClick={() => setStatusFilter(tab.value)}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`tab-badge ${tab.value === 'queue' && count > 0 ? 'urgent' : ''}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="conv-list">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="conv-card">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: '60%', height: 14, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: '80%', height: 12 }} />
                </div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="conv-empty">
            <Inbox size={32} />
            <span>
              {isAgent && statusFilter === 'queue'
                ? 'No pending conversations'
                : isAgent && statusFilter === 'mine'
                  ? 'No active conversations assigned to you'
                  : 'No conversations'}
            </span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((conv) => (
              <motion.div
                key={conv._id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className={`conv-card ${activeConversationId === conv._id ? 'active' : ''} priority-${conv.priority || 'low'}`}
                onClick={() => handleConversationClick(conv)}
              >
                <div className="conv-card-top">
                  <div className="conv-avatar">
                    {isAgent
                      ? getInitials(conv.patient?.name)
                      : conv.channel === 'ai'
                        ? '🤖'
                        : getInitials(conv.agent?.name || '?')}
                  </div>
                  <div className="conv-info">
                    <div className="conv-name">
                      {isAgent
                        ? (conv.patient?.name || 'Patient')
                        : conv.channel === 'ai'
                          ? 'AI Assistant'
                          : conv.agent?.name || 'Waiting for agent...'}
                    </div>
                    <div className="conv-preview">
                      <span className={`channel-badge ${conv.channel}`}>{conv.channel}</span>
                      {' '}
                      <span className={`status-badge ${conv.status}`}>{getStatusLabel(conv)}</span>
                    </div>
                  </div>
                  <div className="conv-meta">
                    <div className={`priority-dot ${conv.priority || 'low'}`} />
                    <div className="conv-meta-right">
                      {conv.status === 'pending' && (
                        <span className="conv-wait-time">
                          <Clock size={10} />
                          {timeAgo(conv.createdAt)}
                        </span>
                      )}
                      <span className="conv-time">{timeAgo(conv.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                {/* Agent ownership indicator */}
                {isAgent && conv.agent && conv.agent._id !== userId && (
                  <div className="conv-agent-label">
                    <UserIcon size={10} />
                    {conv.agent.name || 'Agent'}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
