import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import ContactGroupPicker from '../component/ContactGroupPicker';

const parseCsvRow = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
};

const phoneDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
};

const phoneKey = (digits) => (digits.length > 10 ? digits.slice(-10) : digits);

const extractPhoneFromRow = (cols, columnIndex) => {
  if (columnIndex >= 0) return phoneDigits(cols[columnIndex]);
  for (const col of cols) {
    const found = phoneDigits(col);
    if (found) return found;
  }
  return phoneDigits(cols.join(' '));
};

const parseCsvNumbers = (text) => {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { unique: [], duplicates: 0, skipped: 0 };

  const header = parseCsvRow(lines[0]);
  const headerIndex = header.findIndex((cell) => /phone|mobile|whatsapp|contact/i.test(cell) || /^numbers?$/i.test(String(cell).trim()));
  const start = headerIndex >= 0 ? 1 : 0;

  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  let skipped = 0;

  for (let i = start; i < lines.length; i += 1) {
    const digits = extractPhoneFromRow(parseCsvRow(lines[i]), headerIndex);
    if (!digits) {
      skipped += 1;
      continue;
    }
    const key = phoneKey(digits);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(digits);
  }

  return { unique, duplicates, skipped };
};

const nextPollDelay = (list) => {
  const now = Date.now();
  const busy = list.some((item) => item.status === 'running'
    || (item.status === 'scheduled' && item.scheduledAt && new Date(item.scheduledAt).getTime() - now < 90 * 1000));
  return busy ? 5000 : 60000;
};

const Campaigns = () => {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('Morning outreach');
  const [numbers, setNumbers] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState([]);
  const [csvInfo, setCsvInfo] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState([]);
  const [minGap, setMinGap] = useState('3');
  const [maxGap, setMaxGap] = useState('3');
  const csvRef = useRef(null);

  const readGap = () => {
    const min = Number(minGap);
    const max = Number(maxGap);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < 1) {
      alert('Gap must be at least 1 second');
      return null;
    }
    if (min > 3600 || max > 3600) {
      alert('Gap cannot be more than 3600 seconds');
      return null;
    }
    if (max < min) {
      alert('Max gap must be greater than or equal to min gap');
      return null;
    }
    return { minGap: Math.round(min), maxGap: Math.round(max) };
  };

  const pollTimerRef = useRef(null);
  const pollActiveRef = useRef(false);

  const loadScheduled = () => {
    clearTimeout(pollTimerRef.current);
    return apiFetch('/api/campaigns/scheduled').then(async (res) => {
      const data = await res.json();
      if (!data?.success) return null;
      const list = data.campaigns || [];
      setScheduled(list);
      return list;
    }).catch(() => null).then((list) => {
      clearTimeout(pollTimerRef.current);
      if (!pollActiveRef.current || document.hidden) return;
      pollTimerRef.current = setTimeout(loadScheduled, nextPollDelay(list || []));
    });
  };

  const importCsv = (event) => {
    const csvFile = event.target.files?.[0];
    event.target.value = '';
    if (!csvFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvNumbers(String(reader.result || ''));
      const current = numbers.split(/[\n,]+/).map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 10);
      const seen = new Set(current.map(phoneKey));
      const merged = [...current];
      let extraDupes = 0;
      parsed.unique.forEach((n) => {
        const key = phoneKey(n);
        if (seen.has(key)) {
          extraDupes += 1;
          return;
        }
        seen.add(key);
        merged.push(n);
      });
      const duplicates = parsed.duplicates + extraDupes;
      if (!merged.length) {
        setCsvInfo('No valid numbers found in the file.');
        return;
      }
      setNumbers(merged.join('\n'));
      setCsvInfo(`Imported ${parsed.unique.length - extraDupes} numbers` + (duplicates ? `, removed ${duplicates} duplicates` : '') + (parsed.skipped ? `, skipped ${parsed.skipped}` : '') + '.');
    };
    reader.onerror = () => setCsvInfo('Could not read that file.');
    reader.readAsText(csvFile);
  };

  const loadFromContacts = ({ recipients, label }) => {
    const current = numbers.split(/[\n,]+/).map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 10);
    const seen = new Set(current.map(phoneKey));
    const merged = [...current];
    let added = 0;
    recipients.forEach((r) => {
      const key = phoneKey(r.phone);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(r.phone);
      added += 1;
    });
    if (!recipients.length) {
      setCsvInfo(`No contacts in "${label}".`);
      return;
    }
    setNumbers(merged.join('\n'));
    setCsvInfo(`Added ${added} numbers from "${label}"` + (recipients.length - added ? `, ${recipients.length - added} already in the list` : '') + '.');
  };

  useEffect(() => {
    apiFetch('/api/devices/connected').then(async (res) => {
      const data = await res.json();
      if (Array.isArray(data)) {
        setDevices(data);
        setDeviceId((prev) => prev || (data[0]?.id || ''));
      }
    });
    pollActiveRef.current = true;
    loadScheduled();
    const onVisibility = () => {
      if (document.hidden) clearTimeout(pollTimerRef.current);
      else loadScheduled();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      pollActiveRef.current = false;
      clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const control = (path) => apiFetch(path, { method: 'POST', body: JSON.stringify({ deviceId }) });

  const start = async () => {
    if (!deviceId) return alert('Select a connected device');
    if (!message.trim() && !file) return alert('Enter a message or file');
    const list = numbers.split(/[\n,]+/).map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 10);
    if (!list.length) return alert('Enter valid numbers');
    const gap = readGap();
    if (!gap) return;
    setSending(true);
    setPaused(false);
    setLogs([`Starting ${list.length} recipients (gap ${gap.minGap}-${gap.maxGap}s)...`]);
    try {
      const payload = { deviceId, name, numbers: list.join(','), message: message.trim(), ...gap };
      if (file) payload.attachmentName = await uploadFile(file);
      const res = await apiFetch('/api/send-bulk-stream', { method: 'POST', body: JSON.stringify(payload) });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            setLogs((prev) => [`${row.status?.toUpperCase()} ${row.number || ''} ${row.error || ''}`.trim(), ...prev].slice(0, 80));
          } catch {
            setLogs((prev) => [line, ...prev].slice(0, 80));
          }
        }
      }
    } catch (error) {
      setLogs((prev) => [error.message, ...prev]);
    } finally {
      setSending(false);
      setPaused(false);
    }
  };

  const scheduleCampaign = async () => {
    if (!deviceId) return alert('Select a connected device');
    if (!message.trim() && !file) return alert('Enter a message or file');
    if (!scheduleAt) return alert('Pick a schedule date and time');
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime())) return alert('Invalid schedule time');
    if (when.getTime() <= Date.now() + 60 * 1000) return alert('Schedule time must be at least 1 minute from now');
    const list = numbers.split(/[\n,]+/).map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 10);
    if (!list.length) return alert('Enter valid numbers');
    const gap = readGap();
    if (!gap) return;

    setScheduling(true);
    try {
      const payload = {
        deviceId,
        name,
        numbers: list.join(','),
        message: message.trim(),
        scheduledAt: when.toISOString(),
        ...gap
      };
      if (file) payload.attachmentName = await uploadFile(file);
      const res = await apiFetch('/api/campaigns/schedule', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Schedule failed');
      setLogs((prev) => [
        `SCHEDULED ${list.length} recipients for ${when.toLocaleString()}`,
        ...prev
      ].slice(0, 80));
      loadScheduled();
    } catch (error) {
      alert(error.message);
    } finally {
      setScheduling(false);
    }
  };

  const cancelSchedule = async (id) => {
    if (!window.confirm('Cancel this scheduled campaign?')) return;
    const res = await apiFetch(`/api/campaigns/${id}/cancel-schedule`, { method: 'POST', body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      alert(data.error || 'Cancel failed');
      return;
    }
    loadScheduled();
  };

  const minScheduleValue = () => {
    const d = new Date(Date.now() + 2 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="grid bulk-campaign" style={{ gridTemplateColumns: '1.1fr 0.9fr' }}>
      <div className="card">
        <label className="field"><span>Campaign name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">
          <span>Device</span>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
          </select>
        </label>
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>Numbers</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ContactGroupPicker onPick={loadFromContacts} />
              <button type="button" className="btn light" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => csvRef.current?.click()}>Import CSV</button>
            </div>
          </div>
          <textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="One number per line" />
          <input ref={csvRef} type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={importCsv} />
          {csvInfo ? <small style={{ color: '#6a756e' }}>{csvInfo}</small> : null}
        </div>
        <label className="field"><span>Message</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <label className="field"><span>File</span><input type="file" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <div style={{ display: 'flex', gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Min gap (seconds)</span>
            <input type="number" min="1" max="3600" value={minGap} onChange={(e) => setMinGap(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Max gap (seconds)</span>
            <input type="number" min="1" max="3600" value={maxGap} onChange={(e) => setMaxGap(e.target.value)} />
          </label>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(e) => setScheduleEnabled(e.target.checked)}
          />
          <span>Schedule for later</span>
        </label>
        {scheduleEnabled && (
          <label className="field">
            <span>Send at</span>
            <input
              type="datetime-local"
              value={scheduleAt}
              min={minScheduleValue()}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </label>
        )}
        <div className="bulk-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!scheduleEnabled ? (
            <>
              <button className="btn" onClick={start} disabled={sending && !paused}>Start live send</button>
              <button className="btn gold" disabled={!sending} onClick={async () => { await control('/api/pause-stream'); setPaused(true); }}>Pause</button>
              <button className="btn light" disabled={!sending || !paused} onClick={async () => { await control('/api/resume-stream'); setPaused(false); }}>Resume</button>
              <button className="btn danger" disabled={!sending} onClick={async () => { await control('/api/stop-stream'); }}>Stop</button>
            </>
          ) : (
            <button className="btn" onClick={scheduleCampaign} disabled={scheduling || sending}>
              {scheduling ? 'Scheduling…' : 'Schedule campaign'}
            </button>
          )}
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Live log</h3>
        <div className="logs">{logs.length ? logs.map((line, i) => <div key={i}>{line}</div>) : 'Waiting to start...'}</div>
        <h3 style={{ marginTop: 20 }}>Scheduled</h3>
        {scheduled.length === 0 && <p style={{ color: '#6a756e', fontSize: 13 }}>No upcoming scheduled campaigns.</p>}
        {scheduled.map((item) => {
          const isActive = item.status === 'running' || item.status === 'completed' || item.status === 'failed';
          const progressPct = Number(item.progressPct || 0);
          const successPct = Number(item.successPct || 0);
          const failedPct = Number(item.failedPct || 0);
          return (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid #e2dacb' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>{item.name}</strong>
                <div style={{ color: '#6a756e', fontSize: 12 }}>
                  {item.totalCount} numbers · {item.deviceId} · {item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : '—'}
                  {item.status && item.status !== 'scheduled' ? ` · ${item.status}` : ''}
                </div>
                {isActive && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span>Progress {progressPct}%</span>
                      <span style={{ color: '#6a756e' }}>
                        ✓ {successPct}% · ✗ {failedPct}%
                        {' '}({item.successCount || 0}/{item.failedCount || 0} of {item.totalCount || 0})
                      </span>
                    </div>
                    <div style={{ height: 6, background: '#ebe4d6', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${successPct}%`, background: '#2f9e44', height: '100%' }} />
                      <div style={{ width: `${failedPct}%`, background: '#c92a2a', height: '100%' }} />
                    </div>
                  </div>
                )}
              </div>
              {item.status === 'scheduled' ? (
                <button type="button" className="btn danger" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => cancelSchedule(item.id)}>Cancel</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Campaigns;
