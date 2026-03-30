import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Sparkles } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { useChatStore } from "../stores/chatStore";
import { connectSocket } from "../lib/socket";
import api from "../lib/api";
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
    <div className="dashboard">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      <div className="dashboard-main">
        <header className="workspace-topbar">
          <div>
            <h1>CareDesk Workspace</h1>
            <p>Realtime support platform for AI and human care operations</p>
          </div>
          <div className="workspace-pill-group">
            <span className={`workspace-pill ${isReady ? "ok" : "warn"}`}>
              <Activity size={14} />
              {isReady ? "Systems healthy" : "Readiness degraded"}
            </span>
            <span className="workspace-pill">
              <Sparkles size={14} />
              {user?.role === "agent" ? "Agent mode" : "Patient mode"}
            </span>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {activeView === "conversations" && (
            <motion.div
              key="conversations"
              className="workspace-content"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
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
                      <Activity size={24} />
                    </div>
                    <h3>Select a conversation</h3>
                    <p>
                      Pick one from Queue, Mine, or Resolved to open the
                      workspace.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeView === "analytics" && (
            <motion.div
              key="analytics"
              className="workspace-content analytics-only"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <AnalyticsDashboard />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
