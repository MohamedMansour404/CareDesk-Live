import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('token');
    // Connect directly to the backend (CORS is configured on the server).
    // Using the Vite proxy for WebSocket is unreliable in dev — direct is simpler.
    socket = io(import.meta.env.VITE_WS_URL || 'http://localhost:3000', {
      auth: { token },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
      // Use websocket first, fall back to polling
      transports: ['websocket', 'polling'],
    });

    // Stop reconnecting on auth errors (4xx from server)
    socket.on('connect_error', (err) => {
      if (
        err.message?.includes('invalid token') ||
        err.message?.includes('no auth') ||
        err.message?.includes('jwt')
      ) {
        console.error('[Socket] Auth error – stopping reconnect');
        const s = socket;
        if (s) {
          s.io.opts.reconnection = false;
          s.close();
        }
      }
    });
  }
  return socket;
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    // Always refresh token before connecting
    const token = localStorage.getItem('token');
    if (!token) return; // Don't connect without a token
    s.auth = { token };
    s.io.opts.reconnection = true; // Re-enable if previously disabled
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket) {
    socket.io.opts.reconnection = false;
    socket.disconnect();
    socket = null;
  }
}

export function joinConversation(conversationId: string): void {
  getSocket().emit('join:conversation', { conversationId });
}

export function leaveConversation(conversationId: string): void {
  getSocket().emit('leave:conversation', { conversationId });
}

export function emitTyping(conversationId: string): void {
  getSocket().emit('typing', { conversationId });
}
