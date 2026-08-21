import React from 'react';
import { signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import Chat from './Chat';

const Dashboard: React.FC = () => {
  const { user, assignments } = useAppContext();

  const handleLogout = async () => {
    if (user) {
       await setDoc(doc(db, 'users', user.uid), {
         isActive: false
       }, { merge: true });
    }
    await signOut(auth);
  };

  const changeTheme = async (primary: string, accent: string, background: string) => {
    if (user) {
      await setDoc(doc(db, 'users', user.uid), {
        theme: { primary, accent, background }
      }, { merge: true });
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', background: 'white', padding: '30px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '20px', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, color: 'var(--primary)' }}>Campus Copilot</h1>
        <button onClick={handleLogout} style={{ padding: '8px 16px', background: 'red', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Log Out
        </button>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Theme Preferences</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => changeTheme('#2563eb', '#1e4fc2', '#f5f7fb')} style={{ padding: '8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Default Blue</button>
          <button onClick={() => changeTheme('#10b981', '#059669', '#ecfdf5')} style={{ padding: '8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Emerald</button>
          <button onClick={() => changeTheme('#8b5cf6', '#6d28d9', '#f5f3ff')} style={{ padding: '8px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Purple</button>
        </div>
      </div>

      <div>
        <h2>Active Assignments</h2>
        {assignments.length === 0 ? (
          <p>No active assignments found.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {assignments.map(assignment => (
              <li key={assignment.id} style={{ border: '1px solid #ddd', padding: '15px', marginBottom: '10px', borderRadius: '4px' }}>
                <h3 style={{ margin: '0 0 10px 0' }}>{assignment.title}</h3>
                <p style={{ margin: '5px 0', color: '#666' }}>Course: {assignment.courseName}</p>
                <p style={{ margin: '5px 0', color: '#666' }}>Due: {new Date(assignment.deadlineISO).toLocaleString()}</p>
                <p style={{ margin: '5px 0', color: '#666' }}>Status: {assignment.submissionStatus}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Chat />
    </div>
  );
};

export default Dashboard;
