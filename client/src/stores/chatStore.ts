import { create } from 'zustand';

interface ChatState {
  activeConversationId: string | null;
  typingUsers: Record<string, boolean>;
  statusFilter: string;

  setActiveConversation: (id: string | null) => void;
  setTyping: (userId: string, isTyping: boolean) => void;
  clearTyping: (userId: string) => void;
  setStatusFilter: (filter: string) => void;
  /** Called on logout / user switch — clears all chat state */
  resetStore: () => void;
}

const INITIAL_STATE = {
  activeConversationId: null,
  typingUsers: {},
  statusFilter: 'all',
};

export const useChatStore = create<ChatState>((set) => ({
  ...INITIAL_STATE,

  setActiveConversation: (id) => set({ activeConversationId: id }),

  setTyping: (userId, isTyping) =>
    set((state) => ({
      typingUsers: { ...state.typingUsers, [userId]: isTyping },
    })),

  clearTyping: (userId) =>
    set((state) => {
      const next = { ...state.typingUsers };
      delete next[userId];
      return { typingUsers: next };
    }),

  setStatusFilter: (filter) => set({ statusFilter: filter }),

  resetStore: () => set(INITIAL_STATE),
}));
