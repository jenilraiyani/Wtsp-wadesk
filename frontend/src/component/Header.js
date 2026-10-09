import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSidebar } from './SidebarContext';

const titles = {
  '/': 'Overview',
  '/devices': 'Devices',
  '/compose': 'Single Message',
  '/campaigns': 'Bulk Campaign',
  '/personalize': 'Bulk Personalize',
  '/templates': 'Templates',
  '/contacts': 'Contacts',
  '/automation': 'Automation',
  '/automation/logs': 'Automation logs',
  '/history': 'History',
  '/privacy': 'Privacy',
  '/users': 'Users'
};

const Header = () => {
  const { user, logout } = useAuth();
  const sidebar = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const pageTitle = titles[location.pathname] || 'WaDesk';
  const displayName = user?.name || user?.email || user?.username || '';
  const initial = String(displayName || 'W').charAt(0).toUpperCase();

  return (
    <header className="app-header">
      <div className="app-header-left">
        {user && (
          <button
            type="button"
            className="header-menu-btn"
            onClick={() => sidebar?.toggleSidebar?.()}
            aria-label="Open menu"
          >
            <i className="bi bi-list" />
          </button>
        )}
        <div className="header-brand" onClick={() => navigate('/')} role="button" tabIndex={0}>
          <span className="header-mark">W</span>
          <span className="header-name">WaDesk</span>
        </div>
        <span className="header-divider" />
        <span className="header-page">{pageTitle}</span>
      </div>
      <div className="app-header-right">
        <div className="header-user">
          <strong>{displayName}</strong>
          <span>{user.role === 'admin' ? 'Admin' : 'Operator'}</span>
        </div>
        <div className="header-avatar">{initial}</div>
        <button type="button" className="header-logout" onClick={() => { logout(); navigate('/login'); }}>
          Sign out
        </button>
      </div>
    </header>
  );
};

export default Header;
