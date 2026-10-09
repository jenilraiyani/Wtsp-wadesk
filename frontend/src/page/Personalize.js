import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch } from '../api';
import ContactGroupPicker from '../component/ContactGroupPicker';

const phoneDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
};

const phoneKey = (digits) => (digits.length > 10 ? digits.slice(-10) : digits);

const normalizeHeader = (value) => {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (/^(phone|mobile|whatsapp|contact|number|numbers|mobileno|mobile_no|phone_no|phonenumber)$/.test(raw)) return 'phone';
  if (/^(name|full_name|fullname|firstname|first_name|person|contact_name)$/.test(raw)) return 'name';
  return raw || '';
};

const parseExcelRecipients = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { recipients: [], duplicates: 0, skipped: 0, vars: [] };
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!rows.length) return { recipients: [], duplicates: 0, skipped: 0, vars: [] };

  const headerRow = (rows[0] || []).map((cell) => normalizeHeader(cell));
  const hasHeader = headerRow.some((h) => h === 'phone' || h === 'name' || h.length > 0);
  const phoneIdx = headerRow.findIndex((h) => h === 'phone');
  const start = hasHeader && phoneIdx >= 0 ? 1 : (hasHeader && headerRow.some((h) => h && h !== 'phone') ? 1 : 0);
  const keys = start === 1
    ? headerRow.map((h, i) => h || `col_${i + 1}`)
    : null;

  const seen = new Set();
  const recipients = [];
  let duplicates = 0;
  let skipped = 0;

  for (let i = start; i < rows.length; i += 1) {
    const cols = rows[i] || [];
    if (!cols.some((c) => String(c || '').trim())) continue;

    let phone = '';
    const vars = {};

    if (keys) {
      keys.forEach((key, idx) => {
        const val = String(cols[idx] ?? '').trim();
        if (!key) return;
        if (key === 'phone') {
          phone = phoneDigits(val);
        } else {
          vars[key] = val;
        }
      });
      if (!phone) {
        for (const col of cols) {
          phone = phoneDigits(col);
          if (phone) break;
        }
      }
    } else {
      phone = phoneDigits(cols[0]) || phoneDigits(cols.join(' '));
      if (cols[1] != null && String(cols[1]).trim()) vars.name = String(cols[1]).trim();
    }

    if (!phone) {
      skipped += 1;
      continue;
    }
    const key = phoneKey(phone);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    recipients.push({ phone, ...vars });
  }

  const varSet = new Set();
  recipients.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (k !== 'phone') varSet.add(k);
    });
  });

  return { recipients, duplicates, skipped, vars: [...varSet] };
};

const nextPollDelay = (list) => {
  const now = Date.now();
  const busy = list.some((item) => item.status === 'running'
    || (item.status === 'scheduled' && item.scheduledAt && new Date(item.scheduledAt).getTime() - now < 90 * 1000));
  return busy ? 5000 : 60000;
};

const Personalize = () => {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('Personalized campaign');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState([]);
  const [excelInfo, setExcelInfo] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [excelVars, setExcelVars] = useState([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState([]);
  const [minGap, setMinGap] = useState('3');
  const [maxGap, setMaxGap] = useState('3');
  const excelRef = useRef(null);

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

  const importExcel = (event) => {
    const excelFile = event.target.files?.[0];
    event.target.value = '';
    if (!excelFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseExcelRecipients(reader.result);
        if (!parsed.recipients.length) {
          setExcelInfo('No valid numbers found in the Excel file.');
          setRecipients([]);
          setExcelVars([]);
          return;
        }
        setRecipients(parsed.recipients);
        setExcelVars(parsed.vars);
        setExcelInfo(
          `Imported ${parsed.recipients.length} from Excel`
          + (parsed.vars.length ? ` · vars: ${parsed.vars.map((v) => `{{${v}}}`).join(', ')}` : '')
          + (parsed.duplicates ? `, removed ${parsed.duplicates} duplicates` : '')
          + (parsed.skipped ? `, skipped ${parsed.skipped}` : '')
          + '.'
        );
      } catch (error) {
        setExcelInfo(error.message || 'Could not read that Excel file.');
      }
    };
    reader.onerror = () => setExcelInfo('Could not read that file.');
    reader.readAsArrayBuffer(excelFile);
  };

  const loadFromContacts = ({ recipients: list, vars, label }) => {
    setRecipients(list);
    setExcelVars(vars);
    setExcelInfo(list.length
      ? `Loaded ${list.length} from contacts "${label}"` + (vars.length ? ` · vars: ${vars.map((v) => `{{${v}}}`).join(', ')}` : '') + '.'
      : `No contacts in "${label}".`);
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
    if (!recipients.length) return alert('Import Excel with phone + name columns first');
    if (!message.trim() && !file) return alert('Enter a message or file');
    const gap = readGap();
    if (!gap) return;
    setSending(true);
    setPaused(false);
    setLogs([`Starting ${recipients.length} personalized recipients (gap ${gap.minGap}-${gap.maxGap}s)...`]);
    try {
      const payload = {
        deviceId,
        name,
        numbers: recipients.map((r) => r.phone).join(','),
        recipients,
        message: message.trim(),
        ...gap
      };
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
    if (!recipients.length) return alert('Import Excel with phone + name columns first');
    if (!message.trim() && !file) return alert('Enter a message or file');
    if (!scheduleAt) return alert('Pick a schedule date and time');
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime())) return alert('Invalid schedule time');
    if (when.getTime() <= Date.now() + 60 * 1000) return alert('Schedule time must be at least 1 minute from now');
    const gap = readGap();
    if (!gap) return;

    setScheduling(true);
    try {
      const payload = {
        deviceId,
        name,
        numbers: recipients.map((r) => r.phone).join(','),
        recipients,
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
        `SCHEDULED ${recipients.length} personalized recipients for ${when.toLocaleString()}`,
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

  const preview = recipients[0] && message
    ? message.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const val = recipients[0][String(key).toLowerCase()];
      return val != null ? String(val) : '';
    })
    : '';

  return (
    <div className="grid personalize-page" style={{ gridTemplateColumns: '1.1fr 0.9fr' }}>
      <div className="card">
        <label className="field"><span>Campaign name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">
          <span>Device</span>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
          </select>
        </label>
        <div className="field">
          <div className="personalize-contacts-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>Excel contacts</span>
            <div className="personalize-contacts-tools" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ContactGroupPicker onPick={loadFromContacts} />
              <button type="button" className="btn light" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => excelRef.current?.click()}>Import Excel</button>
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#6a756e', padding: '10px 0' }}>
            {recipients.length
              ? `${recipients.length} contacts loaded`
              : 'Import .xlsx / .xls with phone + name (and other columns)'}
          </div>
          <input ref={excelRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={importExcel} />
          {excelInfo ? <small style={{ color: '#6a756e' }}>{excelInfo}</small> : null}
          {recipients.length > 0 && (
            <div style={{ maxHeight: 140, overflow: 'auto', marginTop: 8, fontSize: 12, borderTop: '1px solid #e2dacb', paddingTop: 8 }}>
              {recipients.slice(0, 8).map((r) => (
                <div key={r.phone}>{r.phone}{r.name ? ` · ${r.name}` : ''}</div>
              ))}
              {recipients.length > 8 ? <div>…and {recipients.length - 8} more</div> : null}
            </div>
          )}
        </div>
        <label className="field">
          <span>Message</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={'Namaste {{name}}, ...'}
          />
          <small style={{ color: '#6a756e' }}>
            Use Excel columns as {'{{name}}'}
            {excelVars.length ? ` · available: ${excelVars.map((v) => `{{${v}}}`).join(', ')}` : ''}
          </small>
        </label>
        {preview ? (
          <div className="field">
            <span>Preview (first contact)</span>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#f7f3ea', padding: 10, borderRadius: 6 }}>{preview}</div>
          </div>
        ) : null}
        <label className="field"><span>File</span><input type="file" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <div className="personalize-gaps" style={{ display: 'flex', gap: 12 }}>
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
        <div className="personalize-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!scheduleEnabled ? (
            <>
              <button className="btn" onClick={start} disabled={sending && !paused}>Start personalized send</button>
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
            <div key={item.id} className="personalize-scheduled-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid #e2dacb' }}>
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

export default Personalize;
