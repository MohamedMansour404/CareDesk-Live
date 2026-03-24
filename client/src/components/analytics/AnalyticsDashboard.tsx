import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  CheckCircle,
  Clock,
  TrendingUp,
  Bot,
  Users,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

interface OverviewStats {
  totalConversations: number;
  activeConversations: number;
  resolvedConversations: number;
  resolutionRate: number;
  totalMessages: number;
  priorityDistribution: Record<string, number>;
  intentDistribution: Record<string, number>;
  channelDistribution: Record<string, number>;
}

interface AgentStats {
  totalConversations: number;
  resolvedConversations: number;
  resolutionRate: number;
  avgResponseTimeFormatted: string;
  evaluation: {
    averageScore: number;
    totalEvaluations: number;
  };
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'var(--red)',
  medium: 'var(--amber)',
  low: 'var(--emerald)',
};

const INTENT_COLORS: Record<string, string> = {
  symptom_report: 'var(--blue)',
  appointment: 'var(--violet)',
  medication: 'var(--teal)',
  general: 'var(--text-muted)',
  emergency: 'var(--red)',
  follow_up: 'var(--amber)',
};

export default function AnalyticsDashboard() {
  const userId = useAuthStore((s) => s.user?._id);

  const { data: overview, isLoading: overviewLoading } = useQuery<OverviewStats>({
    queryKey: ['analytics-overview'],
    queryFn: async () => {
      const res = await api.get('/api/dashboard/stats/overview');
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const { data: agentStats } = useQuery<AgentStats>({
    queryKey: ['analytics-agent', userId],
    queryFn: async () => {
      const res = await api.get(`/api/dashboard/stats/agent/${userId}`);
      return res.data;
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const statCards = overview
    ? [
        {
          label: 'Total Conversations',
          value: overview.totalConversations,
          icon: <MessageSquare size={20} />,
          color: 'var(--blue)',
        },
        {
          label: 'Active Now',
          value: overview.activeConversations,
          icon: <Clock size={20} />,
          color: 'var(--amber)',
        },
        {
          label: 'Resolved',
          value: overview.resolvedConversations,
          icon: <CheckCircle size={20} />,
          color: 'var(--emerald)',
        },
        {
          label: 'Resolution Rate',
          value: `${overview.resolutionRate}%`,
          icon: <TrendingUp size={20} />,
          color: 'var(--violet)',
        },
      ]
    : [];

  const renderDistributionBar = (
    dist: Record<string, number>,
    colorMap: Record<string, string>,
    label: string,
  ) => {
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total === 0) return null;

    return (
      <div className="analytics-dist-card">
        <div className="analytics-dist-header">
          <span>{label}</span>
          <span className="analytics-dist-total">{total} total</span>
        </div>
        <div className="analytics-bar-container">
          {Object.entries(dist)
            .sort(([, a], [, b]) => b - a)
            .map(([key, count]) => (
              <div
                key={key}
                className="analytics-bar-segment"
                style={{
                  width: `${(count / total) * 100}%`,
                  backgroundColor: colorMap[key] || 'var(--text-muted)',
                }}
                title={`${key}: ${count} (${Math.round((count / total) * 100)}%)`}
              />
            ))}
        </div>
        <div className="analytics-legend">
          {Object.entries(dist)
            .sort(([, a], [, b]) => b - a)
            .map(([key, count]) => (
              <div key={key} className="analytics-legend-item">
                <span
                  className="analytics-legend-dot"
                  style={{ backgroundColor: colorMap[key] || 'var(--text-muted)' }}
                />
                <span className="analytics-legend-label">{key.replace('_', ' ')}</span>
                <span className="analytics-legend-count">{count}</span>
              </div>
            ))}
        </div>
      </div>
    );
  };

  if (overviewLoading) {
    return (
      <div className="analytics-panel">
        <div className="analytics-header">
          <BarChart3 size={20} />
          <h2>Analytics Dashboard</h2>
        </div>
        <div className="analytics-loading">Loading analytics...</div>
      </div>
    );
  }

  return (
    <div className="analytics-panel">
      <div className="analytics-header">
        <BarChart3 size={20} />
        <h2>Analytics Dashboard</h2>
      </div>

      {/* Stat Cards */}
      <div className="analytics-stats-grid">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            className="analytics-stat-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <div className="analytics-stat-icon" style={{ color: card.color }}>
              {card.icon}
            </div>
            <div className="analytics-stat-value">{card.value}</div>
            <div className="analytics-stat-label">{card.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Distributions */}
      <div className="analytics-distributions">
        {overview?.channelDistribution &&
          renderDistributionBar(
            overview.channelDistribution,
            { ai: 'var(--violet)', human: 'var(--blue)' },
            'Channel Distribution',
          )}

        {overview?.priorityDistribution &&
          renderDistributionBar(
            overview.priorityDistribution,
            PRIORITY_COLORS,
            'Priority Distribution',
          )}

        {overview?.intentDistribution &&
          renderDistributionBar(
            overview.intentDistribution,
            INTENT_COLORS,
            'Intent Categories',
          )}
      </div>

      {/* Agent Performance */}
      {agentStats && (
        <motion.div
          className="analytics-agent-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="analytics-agent-header">
            <Users size={16} />
            <span>Your Performance</span>
          </div>
          <div className="analytics-agent-grid">
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">{agentStats.totalConversations}</div>
              <div className="analytics-agent-stat-label">Total Handled</div>
            </div>
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">{agentStats.resolvedConversations}</div>
              <div className="analytics-agent-stat-label">Resolved</div>
            </div>
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">{agentStats.resolutionRate}%</div>
              <div className="analytics-agent-stat-label">Resolution Rate</div>
            </div>
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">{agentStats.avgResponseTimeFormatted}</div>
              <div className="analytics-agent-stat-label">Avg Response</div>
            </div>
          </div>
          {agentStats.evaluation.totalEvaluations > 0 && (
            <div className="analytics-eval-bar">
              <span>Quality Score</span>
              <div className="analytics-eval-track">
                <div
                  className="analytics-eval-fill"
                  style={{ width: `${(agentStats.evaluation.averageScore / 10) * 100}%` }}
                />
              </div>
              <span className="analytics-eval-score">
                {agentStats.evaluation.averageScore}/10
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* Messages stat */}
      <div className="analytics-footer-stat">
        <Bot size={14} />
        <span>{overview?.totalMessages ?? 0} total messages processed</span>
      </div>
    </div>
  );
}
