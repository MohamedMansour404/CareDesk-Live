import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Sparkles, ShieldCheck, ChevronsRight } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { useChatStore } from "../stores/chatStore";
import { connectSocket } from "../lib/socket";
import api from "../lib/api";
import { getRoleModeLabel } from "../lib/roleLabels";
import Sidebar from "../components/layout/Sidebar";
import ConversationList from "../components/layout/ConversationList";
import ChatArea from "../components/chat/ChatArea";
import NewConversation from "../components/chat/NewConversation";
import AnalyticsDashboard from "../components/analytics/AnalyticsDashboard";
import "../styles/dashboard.css";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const [activeView, setActiveView] = useState("conversations");

  // Ensure socket is connected
  useEffect(() => {
    connectSocket();
  }, []);

  const { data: readiness } = useQuery({
    queryKey: ["system-readiness"],
    queryFn: async () => {
      const res = await api.get("/api/health/readiness");
      return res.data.data ?? res.data;
    },
    retry: 0,
    refetchInterval: 30_000,
  });

  const isPatient = user?.role === "patient";
  const isReady = readiness?.status === "ok";

  return (
    <div className="workspace-shell">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      <div className="workspace-main">
        <header className="workspace-command-bar">
          <div className="workspace-title-block">
            <h1>CareDesk Command Center</h1>
            <p>
              Live care support orchestrated across AI and specialist workflows
            </p>
          </div>

          <div className="workspace-command-meta">
            <span
              className={`workspace-pill workspace-health ${isReady ? "ok" : "warn"}`}
            >
              <Activity size={14} />
              {isReady ? "Systems healthy" : "Readiness degraded"}
            </span>
            <span className="workspace-pill">
              <Sparkles size={14} />
              {getRoleModeLabel(user?.role)}
            </span>
            <span className="workspace-pill">
              <ShieldCheck size={14} />
              Secure session
            </span>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {activeView === "conversations" && (
            <motion.div
              key="conversations"
              className="workspace-stage"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.24 }}
            >
              <ConversationList />
              {activeConversationId ? (
                <ChatArea />
              ) : isPatient ? (
                <NewConversation />
              ) : (
                <div className="chat-panel">
                  <div className="chat-empty">
                    <div className="chat-empty-icon">
                      <ChevronsRight size={24} />
                    </div>
                    <h3>Select an active thread</h3>
                    <p>
                      Open Queue, Assigned, or Resolved conversations to start
                      the live workspace.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeView === "analytics" && (
            <motion.div
              key="analytics"
              className="workspace-stage analytics-only"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.24 }}
            >
              <AnalyticsDashboard />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
