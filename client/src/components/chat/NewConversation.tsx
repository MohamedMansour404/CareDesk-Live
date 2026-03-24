import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bot, Users } from 'lucide-react';
import api from '../../lib/api';
import { useChatStore } from '../../stores/chatStore';

export default function NewConversation() {
  const queryClient = useQueryClient();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const [creating, setCreating] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (channel: string) => {
      const res = await api.post('/api/conversations', { channel });
      return res.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setActiveConversation(data._id);
      setCreating(false);
    },
  });

  const handleCreate = (channel: string) => {
    setCreating(true);
    createMutation.mutate(channel);
  };

  return (
    <div className="new-conv-panel">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ textAlign: 'center' }}
      >
        <h2>Start a New Conversation</h2>
        <p>Choose how you'd like to get support</p>

        <div className="channel-cards" style={{ marginTop: 24 }}>
          <motion.div
            className="channel-card"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleCreate('ai')}
          >
            <div className="channel-card-icon ai-icon">
              <Bot size={24} />
            </div>
            <h3>AI Assistant</h3>
            <p>Get instant help from our AI</p>
          </motion.div>

          <motion.div
            className="channel-card"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleCreate('human')}
          >
            <div className="channel-card-icon human-icon">
              <Users size={24} />
            </div>
            <h3>Human Agent</h3>
            <p>Talk to a support agent</p>
          </motion.div>
        </div>

        {creating && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: '0.875rem' }}
          >
            Creating conversation…
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}
