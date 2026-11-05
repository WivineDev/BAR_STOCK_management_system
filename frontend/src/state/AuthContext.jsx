import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem('bssbms_token');
    if (!token) { setReady(true); return; }
    api.get('/auth/me').then(({ data }) => setUser(data.user)).catch(() => localStorage.removeItem('bssbms_token')).finally(() => setReady(true));
  }, []);
  const value = useMemo(() => ({ user, ready, async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('bssbms_token', data.token); setUser(data.user);
  }, async setup(details) {
    const { data } = await api.post('/auth/bootstrap', details);
    localStorage.setItem('bssbms_token', data.token); setUser(data.user);
  }, logout() { localStorage.removeItem('bssbms_token'); setUser(null); } }), [user, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
