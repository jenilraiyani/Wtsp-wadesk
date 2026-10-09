import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';

const formatPhone = (phone) => {
  const str = String(phone || '');
  if (str.length === 12 && str.startsWith('91')) return `+91 ${str.slice(2, 7)} ${str.slice(7)}`;
  return `+${str}`;
};

const Devices = () => {
  const { isAdmin } = useAuth();
  const [devices, setDevices] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addPhone, setAddPhone] = useState('');
  const [countryType, setCountryType] = useState('India');
  const [adding, setAdding] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(null);
  const hiddenIds = useRef(new Set());
  const pollTimerRef = useRef(null);
  const activeRef = useRef(false);

  const fetchDevices = async () => {
    clearTimeout(pollTimerRef.current);
    let list = null;
    try {
      const res = await apiFetch('/api/devices');
      const data = await res.json();
      if (Array.isArray(data)) {
        list = data.filter((device) => !hiddenIds.current.has(device.id));
        setDevices(list);
      }
    } catch {
      // keep the current list
    }
    clearTimeout(pollTimerRef.current);
    if (!activeRef.current || document.hidden) return;
    pollTimerRef.current = setTimeout(fetchDevices, 5000);
  };

  const watchDevices = () => fetchDevices();

  useEffect(() => {
    activeRef.current = true;
    watchDevices();
    const onVisibility = () => {
      if (document.hidden) clearTimeout(pollTimerRef.current);
      else fetchDevices();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      activeRef.current = false;
      clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    let cleaned = addPhone.replace(/\D/g, '');
    if (countryType === 'India') {
      if (cleaned.length !== 10) return alert('Indian numbers must be 10 digits.');
      cleaned = '91' + cleaned;
    } else {
      if (cleaned.length !== 9) return alert('UAE numbers must be 9 digits.');
      cleaned = '971' + cleaned;
    }
    setAdding(true);
    try {
      const res = await apiFetch('/api/devices/add', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: cleaned })
      });
      const result = await res.json();
      if (result.success) {
        hiddenIds.current.delete(cleaned);
        setShowAdd(false);
        setAddPhone('');
        watchDevices();
      } else alert(result.error);
    } finally {
      setAdding(false);
    }
  };

  const requestPairingCode = async (device) => {
    if (pairingBusy) return;
    setPairingBusy(device.id);
    try {
      const res = await apiFetch('/api/devices/pair-code', {
        method: 'POST',
        body: JSON.stringify({ deviceId: device.id, phoneNumber: device.id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        alert(data.error || 'Failed to get pairing code');
        return;
      }
      await watchDevices();
    } finally {
      setPairingBusy(null);
    }
  };

  const reconnect = async (id) => {
    await apiFetch('/api/devices/reconnect', { method: 'POST', body: JSON.stringify({ deviceId: id }) });
    watchDevices();
  };

  const remove = async (id) => {
    if (!window.confirm(`Remove +${id}?`)) return;
    const res = await apiFetch('/api/devices/remove', { method: 'POST', body: JSON.stringify({ deviceId: id }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      alert(data.error || 'Failed to remove device');
      return;
    }
    hiddenIds.current.add(id);
    setDevices((prev) => prev.filter((device) => device.id !== id));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn" onClick={() => setShowAdd(true)}>Link WhatsApp</button>
      </div>
      <div className="grid device-grid">
        {devices.length === 0 && (
          <div className="card">No devices yet. Link a number to begin.</div>
        )}
        {devices.map((device) => (
          <div className="card" key={device.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{formatPhone(device.id)}</strong>
              <span className={`status ${device.status === 'CONNECTED' ? 'on' : device.status === 'DISCONNECTED' ? 'off' : 'wait'}`}>{device.status}</span>
            </div>
            {isAdmin && (
              <p style={{ margin: '10px 0 0', color: '#6a756e', fontSize: 13 }}>
                {device.addedBy
                  ? <>Added by <strong style={{ color: '#132019' }}>{device.addedBy.name || device.addedBy.username}</strong>
                    {device.addedBy.role ? ` (${device.addedBy.role})` : ''}
                    {device.addedBy.email ? ` · ${device.addedBy.email}` : ''}</>
                  : 'Added by: unknown'}
              </p>
            )}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              {device.status === 'CONNECTED' && <p>Ready to send.</p>}
              {device.pairingCode ? (
                <>
                  <p style={{ margin: '0 0 8px', color: '#6a756e', fontSize: 13 }}>Enter this code in WhatsApp</p>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4 }}>
                    {String(device.pairingCode).match(/.{1,4}/g)?.join('-')}
                  </div>
                </>
              ) : (
                <>
                  {device.qrImage && (
                    <>
                      <p style={{ margin: '0 0 8px', color: '#6a756e', fontSize: 13 }}>Scan QR with WhatsApp</p>
                      <img src={device.qrImage} alt="QR" style={{ width: 180, borderRadius: 12 }} />
                    </>
                  )}
                  {device.qrImage && device.status !== 'CONNECTED' && device.status !== 'DISCONNECTED' && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn light"
                        disabled={pairingBusy === device.id}
                        onClick={() => requestPairingCode(device)}
                      >
                        {pairingBusy === device.id ? 'Getting code…' : 'Connect with code instead'}
                      </button>
                    </div>
                  )}
                </>
              )}
              {device.status === 'DISCONNECTED' && (
                <button className="btn gold" onClick={() => reconnect(device.id)}>Reconnect</button>
              )}
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button className="btn danger" onClick={() => remove(device.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>Link new WhatsApp</h3>
            <label className="field">
              <span>Country</span>
              <select value={countryType} onChange={(e) => setCountryType(e.target.value)}>
                <option>India</option>
                <option>Dubai</option>
              </select>
            </label>
            <label className="field">
              <span>Phone without country code</span>
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn light" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn" onClick={handleAdd} disabled={adding}>{adding ? 'Starting…' : 'Show QR'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Devices;
