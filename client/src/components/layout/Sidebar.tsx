import {
  MessageSquare,
  BarChart3,
  LogOut,
  Activity,
  Radar,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { useToastStore } from "../../stores/toastStore";
import { getRoleTitle } from "../../lib/roleLabels";

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const isAgent = user?.role === "agent";
  const [isSocketConnected, setIsSocketConnected] = useState(
    () => getSocket().connected,
  );
  const socket = getSocket();
  const hasConnectedOnceRef = useRef(getSocket().connected);

  // Fetch conversations to count pending (agents only)
  const { data } = useQuery({
    queryKey: ["conversations", user?._id, "sidebar-badge"],
    queryFn: async () => {
      const res = await api.get("/api/conversations", {
        params: { page: 1, limit: 100 },
      });
      return res.data.data;
    },
    enabled: isAgent,
    refetchInterval: () => (socket.connected ? false : 15_000),
  });

  const conversations = data?.data || data || [];
  const pendingCount = isAgent
    ? conversations.filter((c: { status: string }) => c.status === "pending")
        .length
    : 0;

  const initials =
    user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  useEffect(() => {
    const handleConnect = () => {
      setIsSocketConnected(true);
      if (hasConnectedOnceRef.current) {
        pushToast("success", "Realtime connection restored.", 2500);
      }
      hasConnectedOnceRef.current = true;
    };

    const handleDisconnect = () => {
      setIsSocketConnected(false);
      if (hasConnectedOnceRef.current) {
        pushToast("info", "Realtime connection lost. Reconnecting…", 3000);
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [pushToast, socket]);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo-wrap">
        <div className="sidebar-logo">CD</div>
        <div className="sidebar-brand">
          <strong>CareDesk</strong>
          <span>Premium Support OS</span>
        </div>
      </div>

      <div className="sidebar-section-title">Workspace</div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-item ${activeView === "conversations" ? "active" : ""}`}
          onClick={() => onViewChange("conversations")}
          title="Conversations Workspace"
          aria-label="Open conversations"
        >
          <span className="sidebar-item-icon">
            <MessageSquare size={18} />
          </span>
          <span className="sidebar-item-text">
            <strong>Conversations</strong>
            <small>Live inbox and chat</small>
          </span>
          {pendingCount > 0 && (
            <span className="sidebar-badge">{pendingCount}</span>
          )}
        </button>

        {isAgent && (
          <button
            className={`sidebar-item ${activeView === "analytics" ? "active" : ""}`}
            onClick={() => onViewChange("analytics")}
            title="Analytics"
            aria-label="Open analytics"
          >
            <span className="sidebar-item-icon">
              <BarChart3 size={18} />
            </span>
            <span className="sidebar-item-text">
              <strong>Analytics</strong>
              <small>Performance intelligence</small>
            </span>
          </button>
        )}
      </nav>

      <div className="sidebar-ops">
        <div className="sidebar-ops-title">Realtime</div>
        <div
          className={`sidebar-connection ${isSocketConnected ? "online" : "offline"}`}
          title={
            isSocketConnected ? "Realtime connected" : "Realtime disconnected"
          }
          role="status"
          aria-live="polite"
          aria-label={
            isSocketConnected ? "Realtime connected" : "Realtime disconnected"
          }
        >
          <span className="dot" />
          <span>{isSocketConnected ? "Connected" : "Reconnecting"}</span>
          <Radar size={12} />
        </div>
        <div className="sidebar-ops-note">
          <Activity size={12} />
          Events synchronized
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div
            className="sidebar-avatar"
            title={`${user?.name} (${getRoleTitle(user?.role)})`}
          >
            {initials}
          </div>
          <div>
            <div className="sidebar-user-name">{user?.name || "User"}</div>
            <span className="sidebar-role">{getRoleTitle(user?.role)}</span>
          </div>
        </div>

        <button
          className="sidebar-item sidebar-logout"
          onClick={logout}
          title="Logout"
          aria-label="Log out"
        >
          <span className="sidebar-item-icon">
            <LogOut size={16} />
          </span>
          <span className="sidebar-item-text">
            <strong>Sign out</strong>
            <small>End this session</small>
          </span>
        </button>
      </div>
    </aside>
  );
}
