import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { connectSocket } from '../lib/socket';
import Sidebar from '../components/layout/Sidebar';
import ConversationList from '../components/layout/ConversationList';
import ChatArea from '../components/chat/ChatArea';
import NewConversation from '../components/chat/NewConversation';
import AnalyticsDashboard from '../components/analytics/AnalyticsDashboard';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const [activeView, setActiveView] = useState('conversations');

  // Ensure socket is connected
  useEffect(() => {
    connectSocket();
  }, []);

  const isPatient = user?.role === 'patient';

  return (
    <div className="dashboard">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      {activeView === 'conversations' && (
        <>
          <ConversationList />
          {activeConversationId ? (
            <ChatArea />
          ) : isPatient ? (
            <NewConversation />
          ) : (
            <div className="chat-panel">
              <div className="chat-empty">
                <div className="chat-empty-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h3>Select a Conversation</h3>
                <p>Choose from the list to start responding</p>
              </div>
            </div>
          )}
        </>
      )}

      {activeView === 'analytics' && (
        <AnalyticsDashboard />
      )}
    </div>
  );
}
