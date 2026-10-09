import React, { useEffect, useState } from 'react';
import { apiJson } from '../api';

const emptyForm = { username: '', email: '', password: '', name: '', role: 'operator', allowedDevices: [] };

const initials = (user) => String(user.name || user.username || user.email || 'U')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part.charAt(0).toUpperCase())
  .join('');

const Users = () => {
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const load = async () => {
    const [{ data: usersData }, { data: devicesData }] = await Promise.all([
      apiJson('/api/users'),
      apiJson('/api/devices?lite=1')
    ]);
    if (Array.isArray(usersData?.users)) setUsers(usersData.users);
    if (Array.isArray(devicesData)) setDevices(devicesData);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  const toggleDevice = (id) => {
    setForm((prev) => ({
      ...prev,
      allowedDevices: prev.allowedDevices.includes(id)
        ? prev.allowedDevices.filter((item) => item !== id)
        : [...prev.allowedDevices, id]
    }));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (user) => {
    setEditingId(user.id);
    setForm({ ...emptyForm, ...user, password: '' });
    setError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = { ...form, allowedDevices: form.role === 'admin' ? [] : form.allowedDevices };
    if (editingId && !payload.password) delete payload.password;
    const { res, data } = await apiJson(editingId ? `/api/users/${editingId}` : '/api/users', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!res.ok) return setError(data.error || 'Save failed');
    closeModal();
    load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete user?')) return;
    await apiJson(`/api/users/${id}`, { method: 'DELETE' });
    load();
  };

  const term = search.trim().toLowerCase();
  const visibleUsers = users.filter((user) => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    if (!term) return true;
    return [user.name, user.email, user.username].some((value) => String(value || '').toLowerCase().includes(term));
  });

  return (
    <div className="users-page">
      <div className="page-intro users-intro">
        <h2>Team members</h2>
        <p>{users.length} {users.length === 1 ? 'user' : 'users'}</p>
      </div>
      <div className="users-toolbar">
        <div className="users-toolbar-left">
          <div className="users-search">
            <i className="bi bi-search" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or username"
            />
          </div>
        </div>
        <div className="users-toolbar-right">
          <div className="users-filter">
            <i className="bi bi-funnel" />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by type">
              <option value="all">All types</option>
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
            </select>
          </div>
          <button className="btn" type="button" onClick={openCreate}>
            <i className="bi bi-person-plus" /> Add user
          </button>
        </div>
      </div>

      <div className="users-grid">
        {visibleUsers.map((user) => {
          const deviceList = user.allowedDevices || [];
          return (
            <div key={user.id} className="user-card">
              <div className="user-card-head">
                <div className={`user-avatar ${user.role === 'admin' ? 'admin' : ''}`}>{initials(user)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="user-name">{user.name || user.username}</div>
                  <div className="user-sub">{user.email || user.username}</div>
                </div>
                <span className={`user-role ${user.role === 'admin' ? 'admin' : ''}`}>
                  {user.role === 'admin' ? 'Admin' : 'Operator'}
                </span>
              </div>
              <div className="user-meta">
                {user.username && <div><i className="bi bi-person" /> {user.username}</div>}
                {user.authProvider === 'google' && <div><i className="bi bi-google" /> Google sign-in</div>}
              </div>
              <div className="user-devices">
                <span className="user-devices-label">Devices</span>
                <div className="user-chips">
                  {user.role === 'admin' && <span className="user-chip all">All devices</span>}
                  {user.role !== 'admin' && deviceList.length === 0 && <span className="user-chip none">None</span>}
                  {user.role !== 'admin' && deviceList.map((id) => <span key={id} className="user-chip">{id}</span>)}
                </div>
              </div>
              <div className="user-actions">
                <button className="btn light" type="button" onClick={() => openEdit(user)}><i className="bi bi-pencil" /> Edit</button>
                <button className="btn danger" type="button" onClick={() => remove(user.id)}><i className="bi bi-trash" /> Delete</button>
              </div>
            </div>
          );
        })}
        {users.length === 0 && <div className="card">No users yet.</div>}
        {users.length > 0 && visibleUsers.length === 0 && <div className="card">No users match your search or filter.</div>}
      </div>

      {modalOpen && (
        <div className="users-modal-backdrop" onMouseDown={closeModal}>
          <form className="users-modal card" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
            <div className="users-modal-head">
              <h3 style={{ margin: 0 }}>{editingId ? 'Edit user' : 'Create user'}</h3>
              <button type="button" className="users-modal-close" onClick={closeModal} aria-label="Close">×</button>
            </div>
            {error && <div style={{ color: '#a23d2f', marginBottom: 12 }}>{error}</div>}
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
            <label className="field"><span>Username</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label className="field"><span>Password</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editingId} placeholder={editingId ? 'Leave blank to keep current password' : ''} /></label>
            <label className="field">
              <span>Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {form.role === 'operator' && (
              <div className="field">
                <span>Allowed devices</span>
                <div className="users-device-list">
                  {devices.length === 0 && <span style={{ color: '#6a756e', fontSize: 13 }}>No devices</span>}
                  {devices.map((device) => (
                    <label key={device.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={form.allowedDevices.includes(device.id)} onChange={() => toggleDevice(device.id)} />
                      {device.id}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn light" type="button" onClick={closeModal}>Cancel</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Update' : 'Create')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Users;
