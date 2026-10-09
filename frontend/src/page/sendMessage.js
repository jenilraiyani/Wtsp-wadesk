import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

const Compose = () => {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [number, setNumber] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');
  const [counts, setCounts] = useState({ sentToday: 0, sentTotal: 0 });

  const loadCounts = () => {
    apiFetch('/api/compose-stats').then(async (res) => {
      const data = await res.json();
      if (data?.success) {
        setCounts({ sentToday: data.sentToday || 0, sentTotal: data.sentTotal || 0 });
      }
    }).catch(() => {});
  };

  useEffect(() => {
    loadCounts();
    apiFetch('/api/devices/connected').then(async (res) => {
      const data = await res.json();
      if (Array.isArray(data)) {
        setDevices(data);
        setDeviceId((prev) => prev || (data[0]?.id || ''));
      }
    });
  }, []);

  const uploadFile = async (f) => {
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
    const res = await apiFetch('/api/upload-attachment', {
      method: 'POST',
      body: JSON.stringify({ filename: f.name, mimeType: f.type, dataBase64 })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');
    return data.attachmentName;
  };

  const send = async () => {
    if (!deviceId || !number.trim()) return alert('Select a device and number');
    if (!message.trim() && !imageUrl && !file) return alert('Add a message or media');
    setSending(true);
    setResult('');
    try {
      const payload = { deviceId, number: number.trim(), message: message.trim() };
      if (imageUrl.trim()) payload.imageUrl = imageUrl.trim();
      if (file) payload.attachmentName = await uploadFile(file);
      const res = await apiFetch('/api/send', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      setResult(data.success ? 'Message delivered.' : (data.error || 'Send failed'));
      if (data.success) loadCounts();
    } catch (error) {
      setResult(error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16, color: '#6a756e', fontSize: 14 }}>
        Sent today: <strong style={{ color: '#132019' }}>{counts.sentToday}</strong>
        {' · '}
        Total sent: <strong style={{ color: '#132019' }}>{counts.sentTotal}</strong>
      </div>
      <label className="field">
        <span>Device</span>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Recipient</span>
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="9198xxxxxxxx" />
      </label>
      <label className="field">
        <span>Message</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <label className="field">
        <span>Image URL</span>
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
      </label>
      <label className="field">
        <span>Attachment</span>
        <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} />
      </label>
      <button className="btn" onClick={send} disabled={sending}>{sending ? 'Sending...' : 'Send message'}</button>
      {result && <p style={{ marginTop: 14 }}>{result}</p>}
    </div>
  );
};

export default Compose;
