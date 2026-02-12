import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API = '/api';
const TOKEN_KEY = 'pause_token';
const USER_KEY = 'pause_user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  const persist = useCallback((u, token) => {
    if (u) {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      if (token) localStorage.setItem(TOKEN_KEY, token);
      setUser(u);
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Erreur de connexion');
      err.errorCode = data.errorCode || null;
      throw err;
    }
    persist(data.user, data.token);
    return data.user;
  }, [persist]);

  const register = useCallback(async (email, password, firstName, lastName, preferredLanguage = 'fr', teamCode) => {
    const body = { email, password, firstName, lastName, preferredLanguage, teamCode };
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur d\'inscription');
    // If account is pending approval, don't persist user/token
    if (data.pending) {
      return { pending: true, message: data.message };
    }
    persist(data.user, data.token);
    return data.user;
  }, [persist]);

  const updatePreferredLanguage = useCallback(
    async (preferredLanguage) => {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API}/auth/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ preferredLanguage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setUser(data.user);
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      } catch {}
    },
    [getToken]
  );

  const logout = useCallback(() => {
    persist(null);
  }, [persist]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    // Refresh user profile from server to get up-to-date role/team
    fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          // 401 = invalid token, 403 = account not approved / rejected
          persist(null);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        if (data?.user) {
          persist(data.user, token);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, getToken, updatePreferredLanguage }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthContext.Provider');
  return ctx;
}
