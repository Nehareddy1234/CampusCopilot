import React, { useState, useEffect } from 'react';
import { app } from '../firebase';

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<{ role: string, content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Generate daily digest on mount
    const fetchDigest = async () => {
      setLoading(true);
      try {
        const { getFunctions, httpsCallable } = await import("firebase/functions");
        const functions = getFunctions(app);
        const chatAgent = httpsCallable(functions, "chatAgent");
        const res = await chatAgent({ message: '__DIGEST__', history: [] }) as any;
        setMessages([{ role: 'assistant', content: res.data.reply }]);
      } catch (err) {
        setMessages([{ role: 'assistant', content: 'Failed to load daily digest. Check your API key.' }]);
      } finally {
        setLoading(false);
      }
    };
    fetchDigest();
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;

    const currentInput = input;
    const newHistory = [...messages, { role: 'user', content: currentInput }];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
        const { getFunctions, httpsCallable } = await import("firebase/functions");
        const functions = getFunctions(app);
        const chatAgent = httpsCallable(functions, "chatAgent");

        // Exclude the digest from history context if it's too long, or just send it
        const res = await chatAgent({ message: currentInput, history: newHistory.slice(-5) }) as any;
        setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error communicating with AI agent.' }]);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <h2>AI Chat Assistant & Daily Digest</h2>
      <div style={{ minHeight: '200px', maxHeight: '400px', overflowY: 'auto', marginBottom: '15px', padding: '10px', background: '#f9f9f9', borderRadius: '4px' }}>
        {messages.length === 0 && !loading ? <p style={{ color: '#888' }}>Ask me about your assignments...</p> : null}
        {messages.map((m, idx) => (
          <div key={idx} style={{ marginBottom: '10px', textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <span style={{
              display: 'inline-block',
              padding: '8px 12px',
              borderRadius: '16px',
              background: m.role === 'user' ? 'var(--primary)' : '#e2e8f0',
              color: m.role === 'user' ? 'white' : 'black',
              whiteSpace: 'pre-wrap'
            }}>
              {m.content}
            </span>
          </div>
        ))}
        {loading && <div style={{ textAlign: 'left', color: '#888' }}>Thinking...</div>}
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type your message..."
          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading} style={{ padding: '10px 20px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
          Send
        </button>
      </div>
    </div>
  );
};

export default Chat;
