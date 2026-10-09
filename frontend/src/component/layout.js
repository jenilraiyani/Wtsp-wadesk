import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSidebar } from './SidebarContext';
import Header from './Header';

const nav = [
  { to: '/', label: 'Overview', icon: 'bi-grid-1x2', end: true },
  { to: '/devices', label: 'Devices', icon: 'bi-phone' },
  { to: '/compose', label: 'Single Message', icon: 'bi-pencil-square' },
  { to: '/campaigns', label: 'Bulk Campaign', icon: 'bi-broadcast' },
  { to: '/personalize', label: 'Bulk Personalize', icon: 'bi-person-lines-fill' },
  { to: '/templates', label: 'Templates', icon: 'bi-file-earmark-text' },
  { to: '/contacts', label: 'Contacts', icon: 'bi-person-rolodex' },
  { to: '/automation', label: 'Automation', icon: 'bi-robot' },
  { to: '/history', label: 'History', icon: 'bi-clock-history' }
];

const Layout = () => {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const sidebar = useSidebar();
  const open = sidebar?.sidebarOpen;
  const titles = {
    '/': ['Overview', 'Live operations across connected numbers'],
    '/devices': ['Devices', 'Link, reconnect and watch session health'],
    '/compose': ['Single Message', 'Send a single message with media'],
    '/campaigns': ['Bulk Campaign', 'Broadcast with live progress controls'],
    '/personalize ': ['Bulk Personalize', 'Excel contacts with {{name}} style messages'],
    '/templates': ['Templates', 'Reusable messages with image, file and Excel variables'],
    '/contacts': ['Contacts', 'Upload your customer list and organise numbers into groups'],
    '/automation': ['Automation', 'Keyword based auto replies for incoming chats'],
    '/automation/logs': ['Automation logs', 'All auto reply execution logs (latest 500)'],
    '/history': ['History', 'Campaign results saved in SQL Server'],
    '/privacy': ['Privacy & disclaimer', 'Policy and unofficial WhatsApp API notice'],
    '/users': ['Team access', 'Admins, operators and device permissions']
  };
  const [title, subtitle] = titles[location.pathname] || ['WaDesk', 'Messaging console'];
  const isActive = (item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
  const close = () => sidebar?.closeSidebar?.();

  return (
    <div className="shell">
      <div className={`sidebar-overlay ${open ? 'visible' : ''}`} onClick={close} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <h1>WaDesk</h1>
            <p>Operations</p>
          </div>
        </div>
        {nav.map((item) => (
          <Link key={item.to} to={item.to} className={`nav-link ${isActive(item) ? 'active' : ''}`} onClick={close}>
            <i className={`bi ${item.icon}`} /> {item.label}
          </Link>
        ))}
        {isAdmin && (
          <Link to="/users" className={`nav-link ${location.pathname === '/users' ? 'active' : ''}`} onClick={close}>
            <i className="bi bi-people" /> Users
          </Link>
        )}
        <Link
          to="/privacy"
          className={`nav-link nav-link-quiet ${location.pathname === '/privacy' ? 'active' : ''}`}
          onClick={close}
        >
          <i className="bi bi-shield" /> Privacy
        </Link>
      </aside>
      <section className="main">
        <Header />
        {location.pathname !== '/users' && (
          <div className="page-intro">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        )}
        <div className="content">
          <Outlet />
        </div>
      </section>
    </div>
  );
};

export default Layout;
