import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  CheckCircle,
  ArrowRight,
  Sparkles,
  MessageSquare,
  X,
  UserRoundPlus,
  Lock,
  AlertTriangle,
} from "lucide-react";
import api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import {
  getSocket,
  joinConversation,
  leaveConversation,
  emitTyping,
} from "../../lib/socket";
import { useToastStore } from "../../stores/toastStore";

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

interface ConversationDetails {
  _id: string;
  channel: string;
  status: string;
  resolvedAt?: string;
  priority?: string;
  patient?: { _id?: string; name?: string };
  agent?: { _id?: string; name?: string };
  intake?: {
    demographics?: { age?: number; gender?: string };
    vitals?: { heightCm?: number; weightKg?: number };
    clinical?: {
      chronicConditions?: string[];
      symptomDuration?: { value?: number; unit?: string };
      painScale?: number;
      mainComplaint?: string;
    };
    triage?: {
      level?: string;
      score?: number;
      reasons?: string[];
    };
  };
}

export default function ChatArea() {
  const {
    activeConversationId,
    setActiveConversation,
    typingUsers,
    setTyping,
    clearTyping,
  } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const pushToast = useToastStore((s) => s.pushToast);
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevConvRef = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [showAssist, setShowAssist] = useState(false);
  const [actionError, setActionError] = useState("");
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const [typingLabel, setTypingLabel] = useState("Someone is typing…");
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const lastMessagesInvalidateRef = useRef(0);
  const lastConversationsInvalidateRef = useRef(0);

  const invalidateMessages = useCallback(
    (conversationId: string | null, minIntervalMs = 300) => {
      if (!conversationId) return;

      const now = Date.now();
      if (now - lastMessagesInvalidateRef.current < minIntervalMs) return;

      lastMessagesInvalidateRef.current = now;
      queryClient.invalidateQueries({
        queryKey: ["messages", conversationId],
      });
    },
    [queryClient],
  );

  const invalidateConversations = useCallback(
    (minIntervalMs = 600) => {
      const now = Date.now();
      if (now - lastConversationsInvalidateRef.current < minIntervalMs) return;

      lastConversationsInvalidateRef.current = now;
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    [queryClient],
  );

  // Fetch messages
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ["messages", activeConversationId],
    queryFn: async () => {
      const res = await api.get(
        `/api/conversations/${activeConversationId}/messages`,
        {
          params: { page: 1, limit: 100 },
        },
      );
      return res.data.data;
    },
    enabled: !!activeConversationId,
  });

  const messages: Message[] = messagesData?.data || messagesData || [];

  // Fetch conversation details
  const { data: convData } = useQuery<ConversationDetails>({
    queryKey: ["conversation", activeConversationId],
    queryFn: async () => {
      const res = await api.get(`/api/conversations/${activeConversationId}`);
      return res.data.data;
    },
    enabled: !!activeConversationId,
  });

  // Fetch AI assistance (agent only)
  const { data: assistData, refetch: refetchAssist } = useQuery<AiAssistData>({
    queryKey: ["ai-assist", activeConversationId],
    queryFn: async () => {
      const res = await api.get(
        `/api/conversations/${activeConversationId}/messages/ai-assist`,
      );
      return res.data.data;
    },
    enabled: !!activeConversationId && user?.role === "agent" && showAssist,
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post(
        `/api/conversations/${activeConversationId}/messages`,
        { content },
      );
      return res.data;
    },
    onSuccess: () => {
      setActionError("");
      invalidateMessages(activeConversationId, 0);
      invalidateConversations(0);
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message ||
        "Failed to send message. Please try again.";
      setActionError(message);
      pushToast("error", message);
    },
  });

  // Resolve mutation (agent or patient)
  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch(
        `/api/conversations/${activeConversationId}/resolve`,
      );
      return res.data;
    },
    onSuccess: () => {
      setActionError("");
      pushToast("success", "Conversation resolved successfully.");
      invalidateConversations(0);
      queryClient.invalidateQueries({
        queryKey: ["conversation", activeConversationId],
      });
      if (user?.role === "patient") {
        setActiveConversation(null);
      }
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message || "Failed to update conversation status.";
      setActionError(message);
      pushToast("error", message);
    },
  });

  // Escalate AI → Human mutation (patient only)
  const escalateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch(
        `/api/conversations/${activeConversationId}/escalate`,
      );
      return res.data;
    },
    onSuccess: () => {
      setActionError("");
      pushToast("success", "Conversation escalated to a human agent.");
      invalidateConversations(0);
      queryClient.invalidateQueries({
        queryKey: ["conversation", activeConversationId],
      });
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message || "Failed to transfer to a human agent.";
      setActionError(message);
      pushToast("error", message);
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
        invalidateMessages(activeConversationId);
      }
      invalidateConversations();
    };

    const handleAiComplete = (data: any) => {
      if (data.conversationId === activeConversationId) {
        invalidateMessages(activeConversationId);
      }
    };

    // Refresh conversation status in real-time when assigned
    const handleConversationAssigned = (data: any) => {
      if (data.conversationId === activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: ["conversation", activeConversationId],
        });
      }
      invalidateConversations();
    };

    const handleConversationTransferred = (data: any) => {
      if (data.conversationId === activeConversationId) {
        pushToast("success", "Conversation transferred successfully.");
        queryClient.invalidateQueries({
          queryKey: ["conversation", activeConversationId],
        });
        invalidateMessages(activeConversationId);
      }
      invalidateConversations();
    };

    // Refresh and auto-close (for patients) when resolved
    const handleConversationResolved = (data: any) => {
      if (data.conversationId === activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: ["conversation", activeConversationId],
        });
        if (userId && user?.role === "patient") {
          setActiveConversation(null);
        }
      }
      invalidateConversations();
    };

    const handleTypingEvent = (data: any) => {
      if (
        data.conversationId === activeConversationId &&
        data.userId !== userId
      ) {
        setTypingLabel(
          data.role === "agent" ? "Agent is typing…" : "Patient is typing…",
        );
        setTyping(data.userId, true);
        setTimeout(() => clearTyping(data.userId), 3000);
      }
    };

    const handleEvaluationNew = (data: any) => {
      if (data.conversationId === activeConversationId) {
        invalidateMessages(activeConversationId);
      }
    };

    const handleQueueFailed = (data: any) => {
      if (data.conversationId === activeConversationId) {
        const message = data.reason
          ? `Queue processing issue: ${data.reason}`
          : "Queue processing issue detected. Your request will be retried.";
        setRuntimeNotice(message);
        pushToast("info", message);
        invalidateMessages(activeConversationId);
      }
      invalidateConversations();
    };

    socket.on("message:new", handleNewMessage);
    socket.on("message:ai:complete", handleAiComplete);
    socket.on("conversation:resolved", handleConversationResolved);
    socket.on("conversation:assigned", handleConversationAssigned);
    socket.on("conversation:escalated", handleConversationAssigned); // reuse — refreshes queries
    socket.on("conversation:transferred", handleConversationTransferred);
    socket.on("evaluation:new", handleEvaluationNew);
    socket.on("message:queue:failed", handleQueueFailed);
    socket.on("agent:typing", handleTypingEvent);
    socket.on("patient:typing", handleTypingEvent);

    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("message:ai:complete", handleAiComplete);
      socket.off("conversation:resolved", handleConversationResolved);
      socket.off("conversation:assigned", handleConversationAssigned);
      socket.off("conversation:escalated", handleConversationAssigned);
      socket.off("conversation:transferred", handleConversationTransferred);
      socket.off("evaluation:new", handleEvaluationNew);
      socket.off("message:queue:failed", handleQueueFailed);
      socket.off("agent:typing", handleTypingEvent);
      socket.off("patient:typing", handleTypingEvent);
    };
  }, [
    activeConversationId,
    queryClient,
    user?._id,
    setTyping,
    clearTyping,
    pushToast,
    invalidateMessages,
    invalidateConversations,
  ]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Handle send
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
    el.style.height = "auto";
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
    new Date(date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const getInitials = (name?: string) =>
    name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

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
            <h3>{convData?.patient?.name || "Conversation"}</h3>
            <span>
              <span className={`channel-badge ${convData?.channel}`}>
                {convData?.channel}
              </span>{" "}
              <span className={`status-badge ${convData?.status}`}>
                {convData?.status?.replace("_", " ")}
              </span>
            </span>
          </div>
        </div>
        <div className="chat-actions">
          {user?.role === "agent" && (
            <>
              <button
                className="chat-action-btn"
                onClick={() => {
                  setShowAssist(!showAssist);
                  if (!showAssist) refetchAssist();
                }}
                title="AI Assistant"
                aria-label="Toggle AI assistant"
                style={
                  showAssist
                    ? {
                        color: "var(--violet)",
                        background: "rgba(139,92,246,0.1)",
                      }
                    : {}
                }
              >
                <Sparkles size={18} />
              </button>
            </>
          )}
          {user?.role === "patient" &&
            convData?.channel === "ai" &&
            convData?.status !== "resolved" && (
              <button
                className="chat-action-btn"
                onClick={() => escalateMutation.mutate()}
                title="Transfer to Human Agent"
                aria-label="Escalate to human agent"
                disabled={escalateMutation.isPending}
                style={{ color: "var(--teal)" }}
              >
                <UserRoundPlus size={18} />
              </button>
            )}
          {convData?.status !== "resolved" && (
            <button
              className="chat-action-btn"
              onClick={() => resolveMutation.mutate()}
              title={user?.role === "agent" ? "Resolve" : "Close Conversation"}
              aria-label={
                user?.role === "agent"
                  ? "Resolve conversation"
                  : "Close conversation"
              }
              disabled={resolveMutation.isPending}
            >
              <CheckCircle size={18} />
            </button>
          )}
          <button
            className="chat-action-btn"
            onClick={() => setActiveConversation(null)}
            title="Close View"
            aria-label="Close conversation view"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {(actionError || runtimeNotice) && (
        <div className="chat-inline-alert">
          <AlertTriangle size={14} />
          <span>{actionError || runtimeNotice}</span>
          <button
            type="button"
            onClick={() => {
              setActionError("");
              setRuntimeNotice("");
            }}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {user?.role === "agent" && convData?.intake && (
        <div
          className="chat-inline-alert"
          style={{
            display: "grid",
            gap: 6,
            alignItems: "start",
            gridTemplateColumns: "1fr",
          }}
        >
          <span>
            <strong>Triage:</strong> {convData.intake.triage?.level || "n/a"}
            {typeof convData.intake.triage?.score === "number" &&
              ` (${convData.intake.triage?.score})`}
          </span>
          <span>
            <strong>Main complaint:</strong>{" "}
            {convData.intake.clinical?.mainComplaint || "n/a"}
          </span>
          <span>
            <strong>Age/Gender:</strong>{" "}
            {convData.intake.demographics?.age || "n/a"}
            {" / "}
            {convData.intake.demographics?.gender || "n/a"}
          </span>
          <span>
            <strong>Pain:</strong>{" "}
            {convData.intake.clinical?.painScale ?? "n/a"}
            {" | "}
            <strong>Duration:</strong>{" "}
            {convData.intake.clinical?.symptomDuration?.value ?? "n/a"}{" "}
            {convData.intake.clinical?.symptomDuration?.unit || ""}
          </span>
          {(convData.intake.clinical?.chronicConditions || []).length > 0 && (
            <span>
              <strong>Chronic conditions:</strong>{" "}
              {convData.intake.clinical?.chronicConditions?.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* AI Assist Bar */}
      <AnimatePresence>
        {showAssist && user?.role === "agent" && assistData && (
          <motion.div
            className="ai-assist-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
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
                <button
                  className="ai-assist-btn primary"
                  onClick={useSuggestion}
                >
                  <ArrowRight size={12} /> Use Suggestion
                </button>
                <button
                  className="ai-assist-btn ghost"
                  onClick={() => refetchAssist()}
                >
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
            <div
              key={i}
              className={`chat-bubble-wrapper ${i % 2 === 0 ? "patient" : "agent"}`}
            >
              <div
                className="skeleton"
                style={{ width: 28, height: 28, borderRadius: "50%" }}
              />
              <div>
                <div
                  className="skeleton"
                  style={{
                    width: 200 + Math.random() * 100,
                    height: 40,
                    borderRadius: 12,
                  }}
                />
              </div>
            </div>
          ))
        ) : messages.length === 0 ? (
          <div className="chat-empty-messages">
            <MessageSquare size={20} />
            <span>No messages yet. Start the conversation below.</span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg._id}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`chat-bubble-wrapper ${msg.senderRole}`}
              >
                <div className={`chat-bubble-avatar ${msg.senderRole}`}>
                  {msg.senderRole === "ai"
                    ? "AI"
                    : getInitials(msg.sender?.name)}
                </div>
                <div>
                  <div className={`chat-bubble ${msg.senderRole}`}>
                    {msg.content}
                  </div>
                  <div className="chat-bubble-time">
                    {formatTime(msg.createdAt)}
                  </div>
                  {msg.analysis && msg.senderRole === "patient" && (
                    <div className="analysis-tags">
                      {msg.analysis.intent && (
                        <span className="analysis-tag intent">
                          {msg.analysis.intent}
                        </span>
                      )}
                      {msg.analysis.priority && (
                        <span className="analysis-tag priority">
                          {msg.analysis.priority}
                        </span>
                      )}
                      {msg.analysis.sentiment && (
                        <span className="analysis-tag sentiment">
                          {msg.analysis.sentiment}
                        </span>
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
              <span />
              <span />
              <span />
            </div>
            {typingLabel}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer or Status Banner */}
      {(() => {
        const isResolved = convData?.status === "resolved";
        const isAgent = user?.role === "agent";
        const isAssignedToMe = convData?.agent?._id === user?._id;
        const isAssignedToOther = isAgent && convData?.agent && !isAssignedToMe;
        const isPending = convData?.status === "pending";
        const canReply =
          !isResolved &&
          (!isAgent || isAssignedToMe || (!convData?.agent && !isPending));

        if (isResolved) {
          return (
            <div
              className="chat-status-banner resolved"
              role="status"
              aria-live="polite"
            >
              <CheckCircle size={16} />
              <span>This conversation has been resolved</span>
              {convData?.resolvedAt && (
                <span className="banner-time">
                  {new Date(convData.resolvedAt).toLocaleString()}
                </span>
              )}
            </div>
          );
        }

        if (isAssignedToOther) {
          return (
            <div
              className="chat-status-banner locked"
              role="status"
              aria-live="polite"
            >
              <Lock size={16} />
              <span>
                This conversation is handled by{" "}
                <strong>{convData?.agent?.name || "another agent"}</strong>
              </span>
            </div>
          );
        }

        if (isAgent && isPending) {
          return (
            <div
              className="chat-status-banner pending"
              role="status"
              aria-live="polite"
            >
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
