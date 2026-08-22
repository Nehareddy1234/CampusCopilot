import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { auth, db } from '../firebase';

interface Assignment {
  id: string;
  title: string;
  courseName: string;
  deadlineString: string;
  deadlineISO: string;
  submissionStatus: string;
}

interface UserProfile {
  theme?: {
    primary?: string;
    accent?: string;
    background?: string;
  };
  lmsUrl?: string;
  username?: string;
}

interface AppContextType {
  user: User | null;
  profile: UserProfile | null;
  assignments: Assignment[];
  loading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setAssignments([]);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Real-time Firestore snapshot for user profile and theme
    const userRef = doc(db, 'users', user.uid);
    const unsubscribeProfile = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    // Real-time Firestore snapshot for assignments
    const assignmentsRef = collection(db, 'users', user.uid, 'assignments');
    const unsubscribeAssignments = onSnapshot(assignmentsRef, (snapshot) => {
      const fetchedAssignments: Assignment[] = [];
      snapshot.forEach((doc) => {
        fetchedAssignments.push({ id: doc.id, ...doc.data() } as Assignment);
      });
      // Sort by closest deadline
      fetchedAssignments.sort((a, b) => new Date(a.deadlineISO).getTime() - new Date(b.deadlineISO).getTime());
      setAssignments(fetchedAssignments);
    });

    return () => {
      unsubscribeProfile();
      unsubscribeAssignments();
    };
  }, [user]);

  return (
    <AppContext.Provider value={{ user, profile, assignments, loading }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
