import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAppContext } from './context/AppContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

const App: React.FC = () => {
  const { user, profile, loading } = useAppContext();

  // Dynamic Theme Engine: bind state to real-time Firestore snapshots
  useEffect(() => {
    if (profile?.theme) {
      const root = document.documentElement;
      if (profile.theme.primary) root.style.setProperty('--primary', profile.theme.primary);
      if (profile.theme.accent) root.style.setProperty('--accent', profile.theme.accent);
      if (profile.theme.background) root.style.setProperty('--background', profile.theme.background);
    } else {
      // Default theme
      const root = document.documentElement;
      root.style.setProperty('--primary', '#2563eb');
      root.style.setProperty('--accent', '#1e4fc2');
      root.style.setProperty('--background', '#f5f7fb');
    }
  }, [profile?.theme]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Router>
      <div style={{ backgroundColor: 'var(--background)', minHeight: '100vh', padding: '20px' }}>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
