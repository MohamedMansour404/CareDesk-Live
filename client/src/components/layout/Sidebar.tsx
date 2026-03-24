import { MessageSquare, BarChart3, LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import api from '../../lib/api';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const isAgent = user?.role === 'agent';

  // Fetch conversations to count pending (agents only)
  const { data } = useQuery({
    queryKey: ['conversations', user?._id, 'sidebar-badge'],
    queryFn: async () => {
      const res = await api.get('/api/conversations', { params: { page: 1, limit: 100 } });
      return res.data.data;
    },
    enabled: isAgent,
    refetchInterval: 15_000,
  });

  const conversations = data?.data || data || [];
  const pendingCount = isAgent
    ? conversations.filter((c: { status: string }) => c.status === 'pending').length
    : 0;

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  return (
    <div className="sidebar">
      <div className="sidebar-logo">CD</div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-item ${activeView === 'conversations' ? 'active' : ''}`}
          onClick={() => onViewChange('conversations')}
          title="Conversations"
        >
          <MessageSquare size={20} />
          {pendingCount > 0 && (
            <span className="sidebar-badge">{pendingCount}</span>
          )}
        </button>

        {isAgent && (
          <button
            className={`sidebar-item ${activeView === 'analytics' ? 'active' : ''}`}
            onClick={() => onViewChange('analytics')}
            title="Analytics"
          >
            <BarChart3 size={20} />
          </button>
        )}
      </nav>

      <div className="sidebar-bottom">
        <button className="sidebar-item" onClick={logout} title="Logout">
          <LogOut size={18} />
        </button>
        <div className="sidebar-avatar" title={`${user?.name} (${user?.role})`}>
          {initials}
        </div>
        <span className="sidebar-role">{user?.role}</span>
      </div>
    </div>
  );
}
