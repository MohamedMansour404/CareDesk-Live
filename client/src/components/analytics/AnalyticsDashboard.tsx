import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MessageSquare,
  CheckCircle,
  Clock,
  TrendingUp,
  Bot,
  Users,
  BarChart3,
  Gauge,
} from "lucide-react";
import api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useMemo } from "react";

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

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

const EMPTY_OVERVIEW: OverviewStats = {
  totalConversations: 0,
  activeConversations: 0,
  resolvedConversations: 0,
  resolutionRate: 0,
  totalMessages: 0,
  priorityDistribution: {},
  intentDistribution: {},
  channelDistribution: {},
};

function readEnvelopeData<T>(payload: ApiEnvelope<T> | T): T {
  const maybeEnvelope = payload as ApiEnvelope<T>;
  return (maybeEnvelope?.data ?? payload) as T;
}

function normalizeOverview(
  payload: ApiEnvelope<OverviewStats> | OverviewStats,
): OverviewStats {
  const data = readEnvelopeData(payload);
  return {
    totalConversations: Number(data?.totalConversations ?? 0),
    activeConversations: Number(data?.activeConversations ?? 0),
    resolvedConversations: Number(data?.resolvedConversations ?? 0),
    resolutionRate: Number(data?.resolutionRate ?? 0),
    totalMessages: Number(data?.totalMessages ?? 0),
    priorityDistribution: data?.priorityDistribution ?? {},
    intentDistribution: data?.intentDistribution ?? {},
    channelDistribution: data?.channelDistribution ?? {},
  };
}

function normalizeAgentStats(
  payload: ApiEnvelope<AgentStats> | AgentStats,
): AgentStats {
  const data = readEnvelopeData(payload);
  return {
    totalConversations: Number(data?.totalConversations ?? 0),
    resolvedConversations: Number(data?.resolvedConversations ?? 0),
    resolutionRate: Number(data?.resolutionRate ?? 0),
    avgResponseTimeFormatted: data?.avgResponseTimeFormatted ?? "N/A",
    evaluation: {
      averageScore: Number(data?.evaluation?.averageScore ?? 0),
      totalEvaluations: Number(data?.evaluation?.totalEvaluations ?? 0),
    },
  };
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "var(--red)",
  medium: "var(--amber)",
  low: "var(--emerald)",
};

const INTENT_COLORS: Record<string, string> = {
  symptom_report: "var(--blue)",
  appointment: "var(--violet)",
  medication: "var(--teal)",
  general: "var(--text-muted)",
  emergency: "var(--red)",
  follow_up: "var(--amber)",
};

export default function AnalyticsDashboard() {
  const userId = useAuthStore((s) => s.user?._id);

  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
  } = useQuery<OverviewStats>({
    queryKey: ["analytics-overview"],
    queryFn: async () => {
      const res = await api.get("/api/dashboard/stats/overview");
      return normalizeOverview(res.data);
    },
    refetchInterval: 30_000,
  });

  const { data: agentStats } = useQuery<AgentStats>({
    queryKey: ["analytics-agent", userId],
    queryFn: async () => {
      const res = await api.get(`/api/dashboard/stats/agent/${userId}`);
      return normalizeAgentStats(res.data);
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const safeOverview = overview ?? EMPTY_OVERVIEW;

  const topIntent = useMemo(() => {
    const entries = Object.entries(safeOverview.intentDistribution || {});
    if (entries.length === 0) return null;
    const [intent, count] = entries.sort(([, a], [, b]) => b - a)[0];
    return { intent, count };
  }, [safeOverview.intentDistribution]);

  const activePressure = useMemo(() => {
    if (!safeOverview.totalConversations) return 0;
    return Math.round(
      (safeOverview.activeConversations / safeOverview.totalConversations) *
        100,
    );
  }, [safeOverview.totalConversations, safeOverview.activeConversations]);

  const statCards = [
    {
      label: "Total Conversations",
      value: safeOverview.totalConversations,
      icon: <MessageSquare size={20} />,
      color: "var(--blue)",
    },
    {
      label: "Active Now",
      value: safeOverview.activeConversations,
      icon: <Clock size={20} />,
      color: "var(--amber)",
    },
    {
      label: "Resolved",
      value: safeOverview.resolvedConversations,
      icon: <CheckCircle size={20} />,
      color: "var(--emerald)",
    },
    {
      label: "Resolution Rate",
      value: `${safeOverview.resolutionRate}%`,
      icon: <TrendingUp size={20} />,
      color: "var(--violet)",
    },
  ];

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
                  backgroundColor: colorMap[key] || "var(--text-muted)",
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
                  style={{
                    backgroundColor: colorMap[key] || "var(--text-muted)",
                  }}
                />
                <span className="analytics-legend-label">
                  {key.replace(/_/g, " ")}
                </span>
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
        <div className="analytics-stats-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="analytics-stat-card">
              <div
                className="skeleton"
                style={{ width: 20, height: 20, marginBottom: 8 }}
              />
              <div
                className="skeleton"
                style={{ width: 90, height: 20, marginBottom: 8 }}
              />
              <div className="skeleton" style={{ width: 110, height: 12 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (overviewError) {
    return (
      <div className="analytics-panel">
        <div className="analytics-header">
          <BarChart3 size={20} />
          <h2>Analytics Dashboard</h2>
        </div>
        <div className="analytics-loading">
          Unable to load analytics right now.
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="analytics-panel">
        <div className="analytics-header">
          <BarChart3 size={20} />
          <h2>Analytics Dashboard</h2>
        </div>
        <div className="analytics-loading">
          No analytics data available yet.
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-panel">
      <motion.div
        className="analytics-hero"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="analytics-header">
          <BarChart3 size={20} />
          <h2>Operations Analytics</h2>
        </div>
        <p>
          Real-time visibility into conversation throughput, quality, and care
          specialist responsiveness.
        </p>
        <div className="analytics-hero-metrics">
          <div className="analytics-hero-pill">
            <Gauge size={14} />
            Active pressure {activePressure}%
          </div>
          {topIntent && (
            <div className="analytics-hero-pill">
              <TrendingUp size={14} />
              Top intent: {topIntent.intent.replace("_", " ")} (
              {topIntent.count})
            </div>
          )}
        </div>
      </motion.div>

      {/* Stat Cards */}
      <div className="analytics-section-head">
        <h3>At a Glance</h3>
        <p>Core workload and resolution indicators for the current period.</p>
      </div>
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

      <div className="analytics-grid-main">
        {/* Distributions */}
        <div className="analytics-distributions">
          <div className="analytics-section-head compact">
            <h3>Flow Breakdown</h3>
            <p>How conversations are split by channel, urgency, and intent.</p>
          </div>
          {safeOverview.channelDistribution &&
            renderDistributionBar(
              safeOverview.channelDistribution,
              { ai: "var(--violet)", human: "var(--blue)" },
              "Channel Distribution",
            )}

          {safeOverview.priorityDistribution &&
            renderDistributionBar(
              safeOverview.priorityDistribution,
              PRIORITY_COLORS,
              "Priority Distribution",
            )}

          {safeOverview.intentDistribution &&
            renderDistributionBar(
              safeOverview.intentDistribution,
              INTENT_COLORS,
              "Intent Categories",
            )}
        </div>

        <motion.aside
          className="analytics-side-insights"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="analytics-insight-card">
            <h4>Conversation Velocity</h4>
            <p>
              {safeOverview.activeConversations} active out of{" "}
              {safeOverview.totalConversations} total conversations.
            </p>
          </div>
          <div className="analytics-insight-card">
            <h4>Resolution Confidence</h4>
            <p>
              {safeOverview.resolutionRate}% currently resolved across tracked
              flows.
            </p>
          </div>
          <div className="analytics-insight-card">
            <h4>Message Throughput</h4>
            <p>{safeOverview.totalMessages} messages processed so far.</p>
          </div>
        </motion.aside>
      </div>

      {/* Agent Performance */}
      {agentStats && (
        <motion.div
          className="analytics-agent-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="analytics-section-head compact analytics-section-head-inline">
            <h3>Specialist Performance</h3>
            <p>Your handling and quality metrics in one view.</p>
          </div>
          <div className="analytics-agent-header">
            <Users size={16} />
            <span>Care Specialist Performance</span>
          </div>
          <div className="analytics-agent-grid">
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">
                {agentStats.totalConversations}
              </div>
              <div className="analytics-agent-stat-label">Total Handled</div>
            </div>
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">
                {agentStats.resolvedConversations}
              </div>
              <div className="analytics-agent-stat-label">Resolved</div>
            </div>
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">
                {agentStats.resolutionRate}%
              </div>
              <div className="analytics-agent-stat-label">Resolution Rate</div>
            </div>
            <div className="analytics-agent-stat">
              <div className="analytics-agent-stat-value">
                {agentStats.avgResponseTimeFormatted}
              </div>
              <div className="analytics-agent-stat-label">Avg Response</div>
            </div>
          </div>
          {agentStats.evaluation.totalEvaluations > 0 && (
            <div className="analytics-eval-bar">
              <span>Quality Score</span>
              <div className="analytics-eval-track">
                <div
                  className="analytics-eval-fill"
                  style={{
                    width: `${(agentStats.evaluation.averageScore / 10) * 100}%`,
                  }}
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
        <span>{safeOverview.totalMessages} total messages processed</span>
      </div>
    </div>
  );
}
