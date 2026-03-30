import { MessageSquare, BarChart3, LogOut, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import api from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { useToastStore } from "../../stores/toastStore";

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
          <span>Support OS</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-item ${activeView === "conversations" ? "active" : ""}`}
          onClick={() => onViewChange("conversations")}
          title="Conversations Workspace"
          aria-label="Open conversations"
        >
          <MessageSquare size={18} />
          <span>Workspace</span>
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
            <BarChart3 size={18} />
            <span>Analytics</span>
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
          <Activity size={12} />
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div
            className="sidebar-avatar"
            title={`${user?.name} (${user?.role})`}
          >
            {initials}
          </div>
          <div>
            <div className="sidebar-user-name">{user?.name || "User"}</div>
            <span className="sidebar-role">{user?.role}</span>
          </div>
        </div>

        <button
          className="sidebar-item sidebar-logout"
          onClick={logout}
          title="Logout"
          aria-label="Log out"
        >
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
