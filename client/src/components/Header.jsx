import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useHeaderSummary } from '../hooks/useHeaderSummary';
import HeaderSummary from './HeaderSummary';
import logo from '../assets/breaktopia-logo.png';
import './Header.css';

/**
 * Reusable global header — role-aware navigation, language selector,
 * real-time summary pill.
 *
 * The Header is the single owner of useHeaderSummary and distributes
 * data to child display components via props.
 *
 * Last-sync information is now displayed next to "Mon équipe" in the
 * Dashboard, not in the header (simpler, always visible).
 */
export default function Header() {
  const { user, logout, getToken } = useAuth();
  const { t, locale, setLocale, supportedLocales } = useLanguage();
  const location = useLocation();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef(null);
  const mobileMenuRef = useRef(null);

  // Live data from single socket (includes pending approvals count for superadmin)
  const { onBreak, working, capacityWarning, pendingCount } = useHeaderSummary(getToken, user?.role);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setDropdownOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const role = user.role;
  const isAdmin = role === 'admin';
  const isSuperAdmin = role === 'superadmin';

  // Build navigation items based on role
  // Admins go straight to /admin — no Dashboard link for them
  const navItems = [];
  if (!isAdmin) {
    navItems.push({ id: 'dashboard', label: t('adminTabs.dashboard'), to: '/' });
  }
  if (isAdmin) {
    navItems.push({ id: 'admin', label: t('admin.title'), to: '/admin' });
  }
  if (isSuperAdmin) {
    navItems.push({ id: 'admin', label: t('admin.title'), to: '/super-admin', badge: pendingCount });
  }

  // Logo home destination: admin → /admin, others → /
  const homeRoute = isAdmin ? '/admin' : '/';

  // Determine active nav item
  const currentPath = location.pathname;
  function isActive(to) {
    if (to === '/') return currentPath === '/' || currentPath === '';
    return currentPath.startsWith(to);
  }

  return (
    <header className="gh" role="banner">
      <div className="gh-inner">
        {/* ── Left: Logo ── */}
        <div className="gh-brand">
          <Link to={homeRoute} className="gh-brand-link" aria-label={t('header.backToDashboard')}>
            <img
              src={logo}
              alt="breaktopia"
              className="gh-logo"
            />
          </Link>
        </div>

        {/* ── Center: Navigation (desktop) ── */}
        <nav className="gh-nav" aria-label="Navigation principale">
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={item.to}
              className={`gh-nav-item${isActive(item.to) ? ' gh-nav-active' : ''}`}
            >
              {item.label}
              {item.badge > 0 && (
                <span className="gh-nav-badge" aria-label={`${item.badge} en attente`}>
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* ── Right: Controls ── */}
        <div className="gh-controls">
          {/* Real-time summary pill */}
          <HeaderSummary
            onBreak={onBreak}
            working={working}
            capacityWarning={capacityWarning}
          />

          {/* Language selector */}
          <div className="gh-lang">
            <span className="gh-lang-icon" aria-hidden="true">🌐</span>
            <select
              className="gh-lang-select"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              aria-label={t('language.label')}
            >
              {supportedLocales.map((loc) => (
                <option key={loc} value={loc}>{loc.toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* User dropdown */}
          <div className="gh-user" ref={dropdownRef}>
            <button
              type="button"
              className="gh-user-btn"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
            >
              <span className="gh-user-avatar" aria-hidden="true">
                {(user.firstName?.[0] || '').toUpperCase()}{(user.lastName?.[0] || '').toUpperCase()}
              </span>
              <span className="gh-user-name">{user.firstName} {user.lastName}</span>
              <span className="gh-user-caret" aria-hidden="true">{dropdownOpen ? '▴' : '▾'}</span>
            </button>

            {dropdownOpen && (
              <div className="gh-dropdown" role="menu">
                <Link to="/account" className="gh-dropdown-item" role="menuitem" onClick={() => setDropdownOpen(false)}>
                  {t('account.title')}
                </Link>
                <button type="button" className="gh-dropdown-item gh-dropdown-danger" role="menuitem" onClick={() => { setDropdownOpen(false); logout(); }}>
                  {t('dashboard.logout')}
                </button>
              </div>
            )}
          </div>

          {/* Hamburger (mobile) */}
          <button
            type="button"
            className="gh-hamburger"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={mobileMenuOpen}
          >
            <span className="gh-hamburger-bar" />
            <span className="gh-hamburger-bar" />
            <span className="gh-hamburger-bar" />
          </button>
        </div>
      </div>

      {/* ── Mobile menu ── */}
      {mobileMenuOpen && (
        <div className="gh-mobile-menu" ref={mobileMenuRef} role="navigation" aria-label="Navigation mobile">
          <nav className="gh-mobile-nav">
            {navItems.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                className={`gh-mobile-nav-item${isActive(item.to) ? ' gh-mobile-nav-active' : ''}`}
              >
                {item.label}
                {item.badge > 0 && (
                  <span className="gh-nav-badge">{item.badge}</span>
                )}
              </Link>
            ))}
          </nav>
          <div className="gh-mobile-divider" />
          <Link to="/account" className="gh-mobile-nav-item" onClick={() => setMobileMenuOpen(false)}>
            {t('account.title')}
          </Link>
          <button type="button" className="gh-mobile-nav-item gh-mobile-danger" onClick={() => { setMobileMenuOpen(false); logout(); }}>
            {t('dashboard.logout')}
          </button>
          <div className="gh-mobile-divider" />
          <div className="gh-mobile-lang">
            <span className="gh-lang-icon" aria-hidden="true">🌐</span>
            <select
              className="gh-lang-select"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              aria-label={t('language.label')}
            >
              {supportedLocales.map((loc) => (
                <option key={loc} value={loc}>{t(`language.${loc}`)}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </header>
  );
}
