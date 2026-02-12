import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { usePresence } from './hooks/usePresence';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import AdminPage from './components/AdminPage';
import SuperAdminPage from './components/SuperAdminPage';
import AccountPage from './components/AccountPage';
import AuditLogPage from './components/AuditLogPage';
import Header from './components/Header';
import LanguageSelector from './components/LanguageSelector';

/* ── Route guards ── */
function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function RequireAdminOrSuperAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin' && user?.role !== 'superadmin') return <Navigate to="/" replace />;
  return children;
}

function RequireSuperAdmin({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'superadmin') return <Navigate to="/" replace />;
  return children;
}

/** Home page resolver: admins land on /admin, everyone else on Dashboard */
function HomePage() {
  const { user } = useAuth();
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  return <Dashboard />;
}

/** Post-login redirect: admins → /admin, others → / */
function getHomeRoute(user) {
  if (user?.role === 'admin') return '/admin';
  return '/';
}

function AppContent() {
  const { user, loading, updatePreferredLanguage, logout, getToken } = useAuth();

  // Presence heartbeat — active only when the user is authenticated.
  // Sends periodic pings and leave signals on pagehide.
  // If the server rejects the token (auto-logout), force client-side logout.
  usePresence(
    user ? getToken : () => null,
    user ? logout : undefined,
  );

  const homeRoute = getHomeRoute(user);

  return (
    <LanguageProvider
      userPreferredLanguage={user?.preferredLanguage}
      onLanguageUpdate={updatePreferredLanguage}
    >
      {loading ? (
        <LoadingScreen />
      ) : (
        <>
          {user ? <Header /> : <LanguageSelector />}
          <Routes>
            <Route path="/" element={user ? <HomePage /> : <Login />} />
            <Route path="/login" element={user ? <Navigate to={homeRoute} replace /> : <Login />} />
            <Route path="/signup" element={user ? <Navigate to={homeRoute} replace /> : <Register />} />
            <Route path="/register" element={user ? <Navigate to={homeRoute} replace /> : <Register />} />

            {/* Account page (any authenticated user) */}
            <Route
              path="/account"
              element={user ? <AccountPage /> : <Navigate to="/" replace />}
            />

            {/* Admin-only route */}
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminPage />
                </RequireAdmin>
              }
            />

            {/* Audit log (admin + superadmin) */}
            <Route
              path="/audit"
              element={
                <RequireAdminOrSuperAdmin>
                  <AuditLogPage />
                </RequireAdminOrSuperAdmin>
              }
            />

            {/* Super-admin-only route */}
            <Route
              path="/super-admin"
              element={
                <RequireSuperAdmin>
                  <SuperAdminPage />
                </RequireSuperAdmin>
              }
            />

            <Route path="*" element={user ? <Navigate to={homeRoute} replace /> : <Navigate to="/" replace />} />
          </Routes>
        </>
      )}
    </LanguageProvider>
  );
}

function LoadingScreen() {
  const { t } = useLanguage();
  return (
    <div className="app-loading">
      <p>{t('app.loading')}</p>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <HashRouter>
          <AppContent />
        </HashRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
