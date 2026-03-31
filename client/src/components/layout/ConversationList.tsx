import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Inbox,
  Clock,
  Search,
  User as UserIcon,
  ArrowUpRight,
} from "lucide-react";
import api from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { getSocket } from "../../lib/socket";
import { useToastStore } from "../../stores/toastStore";

interface Conversation {
  _id: string;
  patient: { _id: string; name: string; email: string };
  agent?: { _id: string; name: string };
  channel: string;
  status: string;
  priority?: string;
  category?: string;
  language?: string;
  intake?: {
    triage?: {
      level?: string;
      score?: number;
    };
    clinical?: {
      mainComplaint?: string;
    };
  };
  intakeSummary?: {
    hasIntake: boolean;
    triageLevel?: string;
    triageScore?: number;
    complaintSnippet?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ── Role-aware tab definitions ──────────────────────────────────
const AGENT_TABS = [
  { label: "Queue", value: "queue" },
  { label: "Assigned", value: "mine" },
  { label: "Resolved", value: "resolved" },
];

const PATIENT_TABS = [
  { label: "Active", value: "active" },
  { label: "Resolved", value: "resolved" },
];

export default function ConversationList() {
  const {
    activeConversationId,
    setActiveConversation,
    statusFilter,
    setStatusFilter,
  } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const pushToast = useToastStore((s) => s.pushToast);
  const userId = user?._id;
  const isAgent = user?.role === "agent";
  const queryClient = useQueryClient();
  const socket = getSocket();
  const lastRefreshAtRef = useRef(0);

  const refreshConversations = useCallback(
    (minIntervalMs = 800) => {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < minIntervalMs) {
        return;
      }

      lastRefreshAtRef.current = now;
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
    },
    [queryClient, userId],
  );

  const [localSearch, setLocalSearch] = useState("");

  // Set default tab based on role (once on mount)
  useEffect(() => {
    if (isAgent && statusFilter === "all") {
      setStatusFilter("queue");
    } else if (!isAgent && statusFilter === "all") {
      setStatusFilter("active");
    }
  }, [isAgent, statusFilter, setStatusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ["conversations", userId, statusFilter],
    queryFn: async () => {
      const res = await api.get("/api/conversations", {
        params: { page: 1, limit: 50 },
      });
      return res.data.data;
    },
    refetchInterval: () => (socket.connected ? false : 15_000),
  });

  const { data: dlqSummary } = useQuery({
    queryKey: ["queue-dlq-summary"],
    queryFn: async () => {
      const res = await api.get("/api/queue/dlq", {
        params: { page: 1, limit: 1 },
      });
      return res.data.data || res.data;
    },
    enabled: isAgent,
    refetchInterval: () => (socket.connected ? false : 15_000),
  });

  // Real-time list refresh on any conversation status change
  useEffect(() => {
    const refresh = () => refreshConversations();
    socket.on("conversation:resolved", refresh);
    socket.on("conversation:assigned", refresh);
    socket.on("conversation:escalated", refresh);
    socket.on("conversation:transferred", refresh);
    socket.on("evaluation:new", refresh);
    socket.on("message:queue:failed", refresh);
    socket.on("conversation:new", refresh);
    socket.on("message:new", refresh);
    return () => {
      socket.off("conversation:resolved", refresh);
      socket.off("conversation:assigned", refresh);
      socket.off("conversation:escalated", refresh);
      socket.off("conversation:transferred", refresh);
      socket.off("evaluation:new", refresh);
      socket.off("message:queue:failed", refresh);
      socket.off("conversation:new", refresh);
      socket.off("message:new", refresh);
    };
  }, [refreshConversations, socket]);

  // Auto-assign mutation (agent clicks a pending conversation)
  const assignMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await api.patch(
        `/api/conversations/${conversationId}/assign`,
      );
      return res.data;
    },
    onSuccess: () => {
      refreshConversations(0);
      pushToast("success", "Conversation assigned to you.");
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message || "Failed to assign conversation.";
      pushToast("error", message);
    },
  });

  const conversations: Conversation[] = data?.data || data || [];

  // ── Filtered + counted views ──────────────────────────────────
  const counts = useMemo(() => {
    if (isAgent) {
      return {
        queue: conversations.filter((c) => c.status === "pending").length,
        mine: conversations.filter(
          (c) =>
            c.agent?._id === userId &&
            ["assigned", "in_progress"].includes(c.status),
        ).length,
        resolved: conversations.filter((c) => c.status === "resolved").length,
      };
    }
    return {
      active: conversations.filter((c) => c.status !== "resolved").length,
      resolved: conversations.filter((c) => c.status === "resolved").length,
    };
  }, [conversations, isAgent, userId]);

  const filtered = useMemo(() => {
    if (isAgent) {
      switch (statusFilter) {
        case "queue":
          return conversations.filter((c) => c.status === "pending");
        case "mine":
          return conversations.filter(
            (c) =>
              c.agent?._id === userId &&
              ["assigned", "in_progress"].includes(c.status),
          );
        case "resolved":
          return conversations.filter((c) => c.status === "resolved");
        default:
          return conversations;
      }
    }
    // Patient
    if (statusFilter === "resolved") {
      return conversations.filter((c) => c.status === "resolved");
    }
    return conversations.filter((c) => c.status !== "resolved");
  }, [conversations, statusFilter, isAgent, userId]);

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [filtered]);

  const visuallyFiltered = useMemo(() => {
    const term = localSearch.toLowerCase().trim();
    if (!term) return sortedFiltered;

    return sortedFiltered.filter((conv) => {
      const patient = conv.patient?.name?.toLowerCase() ?? "";
      const agent = conv.agent?.name?.toLowerCase() ?? "";
      const complaint =
        conv.intakeSummary?.complaintSnippet?.toLowerCase() ??
        conv.intake?.clinical?.mainComplaint?.toLowerCase() ??
        "";
      return (
        patient.includes(term) ||
        agent.includes(term) ||
        complaint.includes(term)
      );
    });
  }, [sortedFiltered, localSearch]);

  const pendingAging = useMemo(() => {
    const now = Date.now();
    return conversations.filter((c) => {
      if (c.status !== "pending") return false;
      const ageMinutes = (now - new Date(c.createdAt).getTime()) / 60000;
      return ageMinutes >= 15;
    }).length;
  }, [conversations]);

  // ── Handle conversation click ─────────────────────────────────
  const handleConversationClick = (conv: Conversation) => {
    // Agent clicking a PENDING conversation → auto-assign
    if (isAgent && conv.status === "pending") {
      assignMutation.mutate(conv._id);
    }
    setActiveConversation(conv._id);
  };

  const tabs = isAgent ? AGENT_TABS : PATIENT_TABS;

  const getInitials = (name?: string) =>
    name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const getStatusLabel = (conv: Conversation) => {
    if (isAgent && conv.agent && conv.agent._id !== userId) {
      return `Assigned to ${conv.agent.name || "Care Specialist"}`;
    }
    return conv.status.replace("_", " ");
  };

  return (
    <div className="conv-panel">
      <div className="conv-header">
        <h2>{isAgent ? "Conversation Inbox" : "Your Conversations"}</h2>
        {isAgent && (
          <div className="conv-queue-health">
            <span>Live queue</span>
            <span>Pending: {counts.queue}</span>
            <span>DLQ: {dlqSummary?.total ?? 0}</span>
          </div>
        )}

        {isAgent && (
          <div className="conv-kpi-row">
            <div className="conv-kpi-card">
              <span>Needs attention</span>
              <strong>{pendingAging}</strong>
            </div>
            <div className="conv-kpi-card">
              <span>Assigned to me</span>
              <strong>{counts.mine}</strong>
            </div>
          </div>
        )}

        <div className="conv-search">
          <Search size={14} />
          <input
            placeholder="Search patient, specialist, or complaint"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
        </div>
        <div className="conv-filters">
          {tabs.map((tab) => {
            const count =
              (counts as unknown as Record<string, number>)[tab.value] ?? 0;
            return (
              <button
                key={tab.value}
                className={`conv-filter-chip ${statusFilter === tab.value ? "active" : ""}`}
                onClick={() => setStatusFilter(tab.value)}
                aria-label={`${tab.label} conversations`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={`tab-badge ${tab.value === "queue" && count > 0 ? "urgent" : ""}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="conv-list-wrap">
        <div className="conv-list">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="conv-card">
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div
                    className="skeleton"
                    style={{ width: 36, height: 36, borderRadius: "50%" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      className="skeleton"
                      style={{ width: "60%", height: 14, marginBottom: 6 }}
                    />
                    <div
                      className="skeleton"
                      style={{ width: "80%", height: 12 }}
                    />
                  </div>
                </div>
              </div>
            ))
          ) : visuallyFiltered.length === 0 ? (
            <div className="conv-empty">
              <Inbox size={32} />
              <span>
                {isAgent && statusFilter === "queue"
                  ? "No pending conversations"
                  : isAgent && statusFilter === "mine"
                    ? "No active conversations assigned to you yet"
                    : "No conversations"}
              </span>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {visuallyFiltered.map((conv) => (
                <motion.div
                  key={conv._id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.22 }}
                  className={`conv-card ${activeConversationId === conv._id ? "active" : ""} priority-${conv.priority || "low"}`}
                  onClick={() => handleConversationClick(conv)}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.995 }}
                >
                  <div className="conv-card-top">
                    <div className="conv-avatar">
                      {isAgent
                        ? getInitials(conv.patient?.name)
                        : conv.channel === "ai"
                          ? "🤖"
                          : getInitials(conv.agent?.name || "?")}
                    </div>
                    <div className="conv-info">
                      <div className="conv-name">
                        {isAgent
                          ? conv.patient?.name || "Patient"
                          : conv.channel === "ai"
                            ? "AI Assistant"
                            : conv.agent?.name || "Waiting for a specialist..."}
                      </div>
                      <div className="conv-preview">
                        <span className={`channel-badge ${conv.channel}`}>
                          {conv.channel}
                        </span>{" "}
                        <span className={`status-badge ${conv.status}`}>
                          {getStatusLabel(conv)}
                        </span>
                        {conv.category && (
                          <span className="status-badge category">
                            {conv.category}
                          </span>
                        )}
                        {(conv.intakeSummary?.triageLevel ||
                          conv.intake?.triage?.level) && (
                          <span
                            className={`status-badge ${conv.priority || "medium"}`}
                          >
                            triage{" "}
                            {conv.intakeSummary?.triageLevel ||
                              conv.intake?.triage?.level}
                          </span>
                        )}
                      </div>
                      {(conv.intakeSummary?.complaintSnippet ||
                        conv.intake?.clinical?.mainComplaint) && (
                        <div className="conv-preview" style={{ marginTop: 4 }}>
                          {(
                            conv.intakeSummary?.complaintSnippet ||
                            conv.intake?.clinical?.mainComplaint ||
                            ""
                          )
                            .toString()
                            .slice(0, 90)}
                        </div>
                      )}
                    </div>
                    <div className="conv-meta">
                      <div
                        className={`priority-dot ${conv.priority || "low"}`}
                      />
                      <div className="conv-meta-right">
                        {conv.status === "pending" && (
                          <span className="conv-wait-time">
                            <Clock size={10} />
                            {timeAgo(conv.createdAt)}
                          </span>
                        )}
                        <span className="conv-time">
                          {timeAgo(conv.updatedAt)}
                        </span>
                      </div>
                      <ArrowUpRight size={12} className="conv-open-arrow" />
                    </div>
                  </div>
                  {/* Agent ownership indicator */}
                  {isAgent && conv.agent && conv.agent._id !== userId && (
                    <div className="conv-agent-label">
                      <UserIcon size={10} />
                      {conv.agent.name || "Care Specialist"}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
