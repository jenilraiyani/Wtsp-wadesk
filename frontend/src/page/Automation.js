import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson, API_URL } from '../api';

const MATCH_LABELS = {
  exact: 'Exact match',
  contains: 'Contains',
  starts_with: 'Starts with'
};

const emptyForm = {
  name: '',
  deviceId: '',
  matchType: 'contains',
  keywords: '',
  replyMessage: 'Hello {{name}} 👋 How can we help you?',
  variables: [],
  options: [],
  attachmentName: '',
  workingHours: { enabled: false, start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5, 6], offReply: '' },
  priority: 0,
  isActive: true
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const hoursLabel = (hours) => {
  const days = [...(hours.days || [])].sort((a, b) => a - b).map((day) => DAY_LABELS[day]).join(', ');
  return `${hours.start}–${hours.end} · ${days}`;
};

const FILE_ACCEPT = 'image/*,video/*,application/pdf';

const fileLabel = (name) => String(name || '').replace(/^\d+_/, '');

const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const toVariableRows = (variables) => Object.entries(variables || {}).map(([key, value]) => ({ key, value }));

const toVariableObject = (rows) => {
  const out = {};
  rows.forEach((row) => {
    const key = String(row.key || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (key) out[key] = row.value || '';
  });
  return out;
};

const formatTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};

const Automation = () => {
  const [devices, setDevices] = useState([]);
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [logRuleId, setLogRuleId] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [uploading, setUploading] = useState('');

  const loadRules = async () => {
    const { data } = await apiJson('/api/automation/rules');
    if (Array.isArray(data?.rules)) setRules(data.rules);
  };

  const loadLogs = async (ruleId = logRuleId) => {
    setLoadingLogs(true);
    const qs = ruleId ? `&ruleId=${encodeURIComponent(ruleId)}` : '';
    const { data } = await apiJson(`/api/automation/logs?limit=5${qs}`);
    if (Array.isArray(data?.logs)) setLogs(data.logs);
    setLoadingLogs(false);
  };

  useEffect(() => {
    apiJson('/api/devices?lite=1').then(({ data }) => {
      if (Array.isArray(data)) {
        setDevices(data);
        setForm((prev) => ({ ...prev, deviceId: prev.deviceId || data[0]?.id || '' }));
      }
    });
    loadRules();
    loadLogs('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setError('');
    setForm({ ...emptyForm, deviceId: devices[0]?.id || '' });
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = { ...form, variables: toVariableObject(form.variables), priority: Number(form.priority) || 0 };
    const { res, data } = await apiJson(editingId ? `/api/automation/rules/${editingId}` : '/api/automation/rules', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!res.ok || !data.success) return setError(data.error || 'Save failed');
    resetForm();
    loadRules();
  };

  const edit = (rule) => {
    setError('');
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      deviceId: rule.deviceId,
      matchType: rule.matchType,
      keywords: (rule.keywords || []).join(', '),
      replyMessage: rule.replyMessage,
      variables: toVariableRows(rule.variables),
      options: (rule.options || []).map((option) => ({
        label: option.label,
        reply: option.reply,
        attachmentName: option.attachmentName || ''
      })),
      attachmentName: rule.attachmentName || '',
      workingHours: { ...emptyForm.workingHours, ...(rule.workingHours || {}) },
      priority: rule.priority,
      isActive: rule.isActive
    });
  };

  const setHours = (field, value) => {
    setForm((prev) => ({ ...prev, workingHours: { ...prev.workingHours, [field]: value } }));
  };

  const toggleDay = (day) => {
    setForm((prev) => {
      const days = prev.workingHours.days.includes(day)
        ? prev.workingHours.days.filter((item) => item !== day)
        : [...prev.workingHours.days, day];
      return { ...prev, workingHours: { ...prev.workingHours, days } };
    });
  };

  const setVariable = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      variables: prev.variables.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    }));
  };

  const addVariable = () => setForm((prev) => ({ ...prev, variables: [...prev.variables, { key: '', value: '' }] }));

  const removeVariable = (index) => setForm((prev) => ({
    ...prev,
    variables: prev.variables.filter((_, i) => i !== index)
  }));

  const setOption = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    }));
  };

  const addOption = () => setForm((prev) => ({ ...prev, options: [...prev.options, { label: '', reply: '', attachmentName: '' }] }));

  const uploadFile = async (file, target) => {
    if (!file) return;
    setError('');
    setUploading(target);
    try {
      const dataBase64 = await readBase64(file);
      const { res, data } = await apiJson('/api/automation/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 })
      });
      if (!res.ok || !data.success) {
        setError(data.error || 'File upload failed');
        return;
      }
      if (target === 'rule') {
        setForm((prev) => ({ ...prev, attachmentName: data.attachmentName }));
      } else {
        setOption(Number(target), 'attachmentName', data.attachmentName);
      }
    } catch {
      setError('File upload failed');
    } finally {
      setUploading('');
    }
  };

  const renderFilePicker = (attachmentName, target, onRemove) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      {attachmentName ? (
        <>
          <a href={`${API_URL}/uploads/automation/${attachmentName}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, wordBreak: 'break-all' }}>
            <i className="bi bi-paperclip" /> {fileLabel(attachmentName)}
          </a>
          <button type="button" className="btn light" style={{ padding: '2px 8px', fontSize: 12 }} onClick={onRemove}>Remove file</button>
        </>
      ) : (
        <label className="btn light" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
          {uploading === target ? 'Uploading…' : '+ Image / Video / PDF'}
          <input
            type="file"
            accept={FILE_ACCEPT}
            style={{ display: 'none' }}
            disabled={Boolean(uploading)}
            onChange={(e) => { uploadFile(e.target.files[0], target); e.target.value = ''; }}
          />
        </label>
      )}
    </div>
  );

  const removeOption = (index) => setForm((prev) => ({
    ...prev,
    options: prev.options.filter((_, i) => i !== index)
  }));

  const toggle = async (rule) => {
    await apiJson(`/api/automation/rules/${rule.id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !rule.isActive })
    });
    loadRules();
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    await apiJson(`/api/automation/rules/${rule.id}`, { method: 'DELETE' });
    if (editingId === rule.id) resetForm();
    loadRules();
  };

  const changeLogFilter = (value) => {
    setLogRuleId(value);
    loadLogs(value);
  };

  return (
    <div className="automation-page">
      <div className="grid automation-grid" style={{ gridTemplateColumns: '0.9fr 1.1fr' }}>
        <form className="card" onSubmit={save}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit rule' : 'Create rule'}</h3>
          {error && <div style={{ color: '#a23d2f', marginBottom: 12 }}>{error}</div>}
          <label className="field">
            <span>Rule name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Greeting" required />
          </label>
          <label className="field">
            <span>Device</span>
            <select value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} required>
              {devices.length === 0 && <option value="">No devices</option>}
              {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Trigger</span>
            <select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })}>
              {Object.entries(MATCH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Keywords (comma or new line)</span>
            <textarea
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              placeholder="hello, hi, price, help"
              style={{ minHeight: 70 }}
              required
            />
          </label>
          <label className="field">
            <span>Reply message</span>
            <textarea value={form.replyMessage} onChange={(e) => setForm({ ...form, replyMessage: e.target.value })} />
            <small style={{ color: '#6a756e' }}>
              Variables: {'{{name}}'} (WhatsApp name), {'{{phone}}'}, {'{{message}}'} (customer text)
              {form.variables.some((row) => row.key.trim()) && (
                <>, {form.variables.filter((row) => row.key.trim()).map((row) => `{{${row.key.trim().toLowerCase().replace(/\s+/g, '_')}}}`).join(', ')}</>
              )}
            </small>
          </label>
          <div className="field">
            <span>Reply file (optional)</span>
            {renderFilePicker(form.attachmentName, 'rule', () => setForm((prev) => ({ ...prev, attachmentName: '' })))}
            <small style={{ color: '#6a756e' }}>The reply message is sent as the file caption.</small>
          </div>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Custom variables</span>
              <button type="button" className="btn light" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addVariable}>+ Add variable</button>
            </div>
            {form.variables.length === 0 && (
              <small style={{ color: '#6a756e' }}>Example: price = 499, then write {'{{price}}'} in the reply.</small>
            )}
            {form.variables.map((row, index) => (
              <div key={index} className="automation-var-row" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  value={row.key}
                  onChange={(e) => setVariable(index, 'key', e.target.value)}
                  placeholder="price"
                  style={{ flex: '0 0 35%', minWidth: 0 }}
                />
                <input
                  value={row.value}
                  onChange={(e) => setVariable(index, 'value', e.target.value)}
                  placeholder="499"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="button" className="btn danger" style={{ padding: '4px 10px' }} onClick={() => removeVariable(index)} aria-label="Remove variable">×</button>
              </div>
            ))}
          </div>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Options (menu)</span>
              <button type="button" className="btn light" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addOption}>+ Add option</button>
            </div>
            {form.options.length === 0 && (
              <small style={{ color: '#6a756e' }}>
                Optional. Example: Bike, Car, Truck. The customer gets a numbered list and can answer with the number or name.
              </small>
            )}
            {form.options.map((row, index) => (
              <div key={index} style={{ border: '1px solid #e3e8e4', borderRadius: 8, padding: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong style={{ minWidth: 18 }}>{index + 1}.</strong>
                  <input
                    value={row.label}
                    onChange={(e) => setOption(index, 'label', e.target.value)}
                    placeholder="Bike"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="button" className="btn danger" style={{ padding: '4px 10px' }} onClick={() => removeOption(index)} aria-label="Remove option">×</button>
                </div>
                <textarea
                  value={row.reply}
                  onChange={(e) => setOption(index, 'reply', e.target.value)}
                  placeholder="Bike price starts from ₹{{bike_price}}"
                  style={{ marginTop: 8, minHeight: 60, width: '100%' }}
                />
                {renderFilePicker(row.attachmentName, String(index), () => setOption(index, 'attachmentName', ''))}
              </div>
            ))}
            {form.options.some((row) => row.label.trim()) && (
              <div className="logs" style={{ marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 'none' }}>
                {`${form.replyMessage}\n\n${form.options.filter((row) => row.label.trim()).map((row, i) => `${i + 1}. ${row.label.trim()}`).join('\n')}\n\nReply with the number or name.`}
              </div>
            )}          </div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.workingHours.enabled} onChange={(e) => setHours('enabled', e.target.checked)} />
              <span style={{ margin: 0 }}>Working hours (India time)</span>
            </label>
            {form.workingHours.enabled && (
              <div style={{ border: '1px solid #e3e8e4', borderRadius: 10, padding: 12, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: 1, minWidth: 120, marginBottom: 8 }}>
                    <span>From</span>
                    <input type="time" value={form.workingHours.start} onChange={(e) => setHours('start', e.target.value)} required />
                  </label>
                  <label className="field" style={{ flex: 1, minWidth: 120, marginBottom: 8 }}>
                    <span>To</span>
                    <input type="time" value={form.workingHours.end} onChange={(e) => setHours('end', e.target.value)} required />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {DAY_LABELS.map((label, day) => (
                    <button
                      key={label}
                      type="button"
                      className={`btn ${form.workingHours.days.includes(day) ? '' : 'light'}`}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => toggleDay(day)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>Reply outside working hours (optional)</span>
                  <textarea
                    value={form.workingHours.offReply}
                    onChange={(e) => setHours('offReply', e.target.value)}
                    placeholder="Namaste {{name}}, our shop is closed now. We are open Mon–Sat, 10 AM to 7 PM."
                    style={{ minHeight: 60 }}
                  />
                  <small style={{ color: '#6a756e' }}>
                    Leave empty to skip this rule outside working hours. A time like 22:00 to 06:00 runs overnight.
                  </small>
                </label>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Priority (higher runs first)</span>
              <input type="number" min="-1000" max="1000" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              <span>Active</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={saving || Boolean(uploading)}>{saving ? 'Saving…' : (editingId ? 'Update rule' : 'Create rule')}</button>
            {editingId && <button className="btn light" type="button" onClick={resetForm}>Cancel</button>}
          </div>
        </form>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Rules</h3>
          <div className="automation-table-wrap">
            <table className="table">
              <thead><tr><th>Rule</th><th>Trigger</th><th>Priority</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      {rule.name}
                      <div style={{ color: '#6a756e', fontSize: 12 }}>{rule.deviceId}</div>
                    </td>
                    <td>
                      {MATCH_LABELS[rule.matchType] || rule.matchType}
                      <div style={{ color: '#6a756e', fontSize: 12 }}>{(rule.keywords || []).join(', ')}</div>
                      {rule.attachmentName && (
                        <div style={{ color: '#6a756e', fontSize: 12 }}><i className="bi bi-paperclip" /> {fileLabel(rule.attachmentName)}</div>
                      )}
                      {rule.options?.length > 0 && (
                        <div style={{ color: '#6a756e', fontSize: 12 }}>Menu: {rule.options.map((option) => option.label).join(', ')}</div>
                      )}
                      {rule.workingHours?.enabled && (
                        <div style={{ color: '#6a756e', fontSize: 12 }}><i className="bi bi-clock" /> {hoursLabel(rule.workingHours)}</div>
                      )}
                    </td>
                    <td>{rule.priority}</td>
                    <td>
                      <button
                        type="button"
                        className={`status ${rule.isActive ? 'on' : 'off'}`}
                        style={{ border: 0, cursor: 'pointer' }}
                        onClick={() => toggle(rule)}
                        title="Click to enable / disable"
                      >
                        {rule.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn light" type="button" onClick={() => edit(rule)}>Edit</button>
                      {' '}
                      <button className="btn danger" type="button" onClick={() => remove(rule)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr><td colSpan="5">No automation rules yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Execution logs</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={logRuleId} onChange={(e) => changeLogFilter(e.target.value)} style={{ padding: '6px 10px' }}>
              <option value="">All rules</option>
              {rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
            </select>
            <button className="btn light" type="button" onClick={() => loadLogs()} disabled={loadingLogs}>
              {loadingLogs ? 'Loading…' : 'Refresh'}
            </button>
            <Link className="btn" to="/automation/logs">View all</Link>
          </div>
        </div>
        <div className="automation-table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Rule</th><th>From</th><th>Received</th><th>Reply</th><th>Status</th></tr></thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatTime(log.createdAt)}</td>
                  <td>
                    {log.ruleName || '-'}
                    {log.matchedKeyword && <div style={{ color: '#6a756e', fontSize: 12 }}>“{log.matchedKeyword}”</div>}
                  </td>
                  <td>
                    {log.contactName || '-'}
                    <div style={{ color: '#6a756e', fontSize: 12 }}>{log.chatId}</div>
                  </td>
                  <td>{log.incomingText}</td>
                  <td>{log.replyText}</td>
                  <td>
                    <span className={`status ${log.status === 'success' ? 'on' : 'off'}`}>{log.status}</span>
                    {log.error && <div style={{ color: '#a23d2f', fontSize: 12 }}>{log.error}</div>}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan="6">No automation replies yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Automation;
