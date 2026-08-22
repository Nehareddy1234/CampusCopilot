import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, app } from '../firebase';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [lmsUsername, setLmsUsername] = useState('');
  const [lmsPassword, setLmsPassword] = useState('');
  const [lmsUrl, setLmsUrl] = useState('https://lms.vit.ac.in/login/index.php');
  const [apiKey, setApiKey] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
        // We rely on the HTTPS callable function to store sensitive encrypted credentials securely on the backend.
        const { getFunctions, httpsCallable } = await import("firebase/functions");
        const functions = getFunctions(app);
        const connectLms = httpsCallable(functions, "connectLms");
        await connectLms({ lmsUsername, lmsPassword, lmsUrl, apiKey });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        // Update active session flag
        await setDoc(doc(db, 'users', auth.currentUser!.uid), {
          isActive: true
        }, { merge: true });
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto', padding: '20px', background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
      <h2>{isSignUp ? 'Sign Up' : 'Login'}</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
        />

        {isSignUp && (
          <>
            <hr style={{ margin: '10px 0', border: 'none', borderBottom: '1px solid #eee' }} />
            <h4 style={{ margin: 0, color: '#555' }}>LMS Credentials</h4>
            <input
              type="text"
              placeholder="LMS Username"
              value={lmsUsername}
              onChange={(e) => setLmsUsername(e.target.value)}
              required
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <input
              type="password"
              placeholder="LMS Password"
              value={lmsPassword}
              onChange={(e) => setLmsPassword(e.target.value)}
              required
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <input
              type="url"
              placeholder="LMS URL"
              value={lmsUrl}
              onChange={(e) => setLmsUrl(e.target.value)}
              required
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <input
              type="password"
              placeholder="OpenRouter/OpenAI API Key (Optional)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </>
        )}

        <button type="submit" style={{ padding: '10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {isSignUp ? 'Sign Up' : 'Login'}
        </button>
      </form>
      <button
        onClick={() => setIsSignUp(!isSignUp)}
        style={{ marginTop: '15px', background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
      >
        {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
      </button>
    </div>
  );
};

export default Login;
