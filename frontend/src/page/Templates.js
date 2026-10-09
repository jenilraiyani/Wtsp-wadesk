import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch, apiJson, API_URL } from '../api';
import ContactGroupPicker from '../component/ContactGroupPicker';

const emptyForm = { name: '', body: '', imageName: '', fileName: '' };

const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,video/*,audio/*';

const fileLabel = (name) => String(name || '').replace(/^\d+_/, '');

const fileUrl = (name) => `${API_URL}/uploads/templates/${name}`;

const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const extractVariables = (body) => {
  const found = new Set();
  String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    found.add(String(key).toLowerCase());
    return '';
  });
  return [...found];
};

const applyTemplate = (template, vars = {}) => {
  const map = {};
  Object.keys(vars || {}).forEach((key) => { map[String(key).toLowerCase()] = vars[key] == null ? '' : String(vars[key]); });
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => map[String(key).toLowerCase()] ?? '');
};

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
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (!rows.length) return { recipients: [], duplicates: 0, skipped: 0, vars: [] };

  const headerRow = (rows[0] || []).map((cell) => normalizeHeader(cell));
  const hasHeader = headerRow.some((h) => h.length > 0) && !headerRow.some((h) => phoneDigits(h));
  const keys = hasHeader ? headerRow.map((h, i) => h || `col_${i + 1}`) : null;
  const start = hasHeader ? 1 : 0;

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
        if (key === 'phone') phone = phoneDigits(val);
        else vars[key] = val;
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
  recipients.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'phone') varSet.add(k); }));
  return { recipients, duplicates, skipped, vars: [...varSet] };
};

const Templates = () => {
  const [templates, setTemplates] = useState([]);
  const [limit, setLimit] = useState(5);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [excelVars, setExcelVars] = useState([]);
  const [excelInfo, setExcelInfo] = useState('');
  const [minGap, setMinGap] = useState('3');
  const [maxGap, setMaxGap] = useState('3');
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState([]);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const excelRef = useRef(null);

  useEffect(() => {
    if (!previewTemplate) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewTemplate(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewTemplate]);

  const loadTemplates = async () => {
    const { data } = await apiJson('/api/templates');
    if (Array.isArray(data?.templates)) {
      setTemplates(data.templates);
      if (data.limit) setLimit(data.limit);
      setSelectedId((prev) => (data.templates.some((t) => t.id === prev) ? prev : (data.templates[0]?.id || '')));
    }
  };

  useEffect(() => {
    loadTemplates();
    apiJson('/api/devices/connected').then(({ data }) => {
      if (Array.isArray(data)) {
        setDevices(data);
        setDeviceId((prev) => prev || data[0]?.id || '');
      }
    });
  }, []);

  const selected = templates.find((t) => t.id === selectedId) || null;
  const missingVars = useMemo(() => {
    if (!selected || !recipients.length) return [];
    return selected.variables.filter((v) => v !== 'phone' && !excelVars.includes(v));
  }, [selected, recipients, excelVars]);

  const resetForm = () => {
    setEditingId(null);
    setError('');
    setForm(emptyForm);
  };

  const uploadFile = async (file, kind) => {
    if (!file) return;
    setError('');
    setUploading(kind);
    try {
      const dataBase64 = await readBase64(file);
      const { res, data } = await apiJson('/api/templates/upload', {
        method: 'POST',
        body: JSON.stringify({ kind, filename: file.name, mimeType: file.type, dataBase64 })
      });
      if (!res.ok || !data.success) {
        setError(data.error || 'Upload failed');
        return;
      }
      setForm((prev) => ({ ...prev, [kind === 'image' ? 'imageName' : 'fileName']: data.name }));
    } catch {
      setError('Upload failed');
    } finally {
      setUploading('');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const { res, data } = await apiJson(editingId ? `/api/templates/${editingId}` : '/api/templates', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(form)
    });
    setSaving(false);
    if (!res.ok || !data.success) return setError(data.error || 'Save failed');
    resetForm();
    loadTemplates();
  };

  const edit = (template) => {
    setError('');
    setEditingId(template.id);
    setForm({
      name: template.name,
      body: template.body,
      imageName: template.imageName,
      fileName: template.fileName
    });
  };

  const remove = async (template) => {
    if (!window.confirm(`Delete template "${template.name}"?`)) return;
    await apiJson(`/api/templates/${template.id}`, { method: 'DELETE' });
    if (editingId === template.id) resetForm();
    loadTemplates();
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
          `Imported ${parsed.recipients.length} contacts`
          + (parsed.vars.length ? ` · columns: ${parsed.vars.map((v) => `{{${v}}}`).join(', ')}` : '')
          + (parsed.duplicates ? `, removed ${parsed.duplicates} duplicates` : '')
          + (parsed.skipped ? `, skipped ${parsed.skipped}` : '')
          + '.'
        );
      } catch (err) {
        setExcelInfo(err.message || 'Could not read that Excel file.');
      }
    };
    reader.onerror = () => setExcelInfo('Could not read that file.');
    reader.readAsArrayBuffer(excelFile);
  };

  const loadFromContacts = ({ recipients: list, vars, label }) => {
    setRecipients(list);
    setExcelVars(vars);
    setExcelInfo(list.length
      ? `Loaded ${list.length} contacts from "${label}"` + (vars.length ? ` · columns: ${vars.map((v) => `{{${v}}}`).join(', ')}` : '') + '.'
      : `No contacts in "${label}".`);
  };

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

  const control = (path) => apiFetch(path, { method: 'POST', body: JSON.stringify({ deviceId }) });

  const start = async () => {
    if (!selected) return alert('Select a template');
    if (!deviceId) return alert('Select a connected device');
    if (!recipients.length) return alert('Import an Excel file with a phone column first');
    if (missingVars.length && !window.confirm(
      `Excel has no column for ${missingVars.map((v) => `{{${v}}}`).join(', ')}. These will be sent empty. Continue?`
    )) return;
    const gap = readGap();
    if (!gap) return;

    setSending(true);
    setPaused(false);
    setLogs([`Starting "${selected.name}" for ${recipients.length} contacts (gap ${gap.minGap}-${gap.maxGap}s)...`]);
    try {
      const res = await apiFetch(`/api/templates/${selected.id}/send-stream`, {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          name: campaignName.trim() || undefined,
          numbers: recipients.map((r) => r.phone).join(','),
          recipients,
          ...gap
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Send failed');
      }
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
            const progress = row.index ? ` (${row.index}/${row.total})` : '';
            setLogs((prev) => [`${row.status?.toUpperCase()}${progress} ${row.number || row.message || ''} ${row.error || ''}`.trim(), ...prev].slice(0, 80));
          } catch {
            setLogs((prev) => [line, ...prev].slice(0, 80));
          }
        }
      }
    } catch (err) {
      setLogs((prev) => [err.message, ...prev]);
    } finally {
      setSending(false);
      setPaused(false);
    }
  };

  const renderAttachment = (name, kind) => (
    name ? (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href={fileUrl(name)} target="_blank" rel="noreferrer" style={{ fontSize: 13, wordBreak: 'break-all' }}>
          <i className={`bi ${kind === 'image' ? 'bi-image' : 'bi-paperclip'}`} /> {fileLabel(name)}
        </a>
        <button
          type="button"
          className="btn light"
          style={{ padding: '2px 8px', fontSize: 12 }}
          onClick={() => setForm((prev) => ({ ...prev, [kind === 'image' ? 'imageName' : 'fileName']: '' }))}
        >
          Remove
        </button>
      </div>
    ) : (
      <label className="btn light" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start' }}>
        {uploading === kind ? 'Uploading…' : (kind === 'image' ? '+ Add image' : '+ Add file')}
        <input
          type="file"
          accept={kind === 'image' ? 'image/*' : FILE_ACCEPT}
          style={{ display: 'none' }}
          disabled={Boolean(uploading)}
          onChange={(e) => { uploadFile(e.target.files[0], kind); e.target.value = ''; }}
        />
      </label>
    )
  );

  const renderPreviewBody = (body) => {
    const sample = recipients[0] || {};
    const values = {};
    Object.keys(sample).forEach((key) => { values[key.toLowerCase()] = sample[key]; });
    return String(body || '').split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g).map((part, i) => {
      const match = part.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
      if (!match) return part;
      const value = values[match[1].toLowerCase()];
      return value
        ? <span key={i}>{value}</span>
        : <span key={i} className="tpl-preview-var">{part}</span>;
    });
  };

  const formVars = extractVariables(form.body);
  const limitReached = !editingId && templates.length >= limit;
  const preview = selected ? applyTemplate(selected.body, recipients[0] || {}) : '';

  return (
    <div className="templates-page">
      <div className="grid templates-grid" style={{ gridTemplateColumns: '0.9fr 1.1fr' }}>
        <form className="card" onSubmit={save}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{editingId ? 'Edit template' : 'Create template'}</h3>
            <span className={`status ${templates.length >= limit ? 'off' : 'on'}`}>{templates.length} / {limit} used</span>
          </div>
          {error && <div style={{ color: '#a23d2f', marginBottom: 12 }}>{error}</div>}
          {limitReached && (
            <div style={{ color: '#8a6a1f', marginBottom: 12, fontSize: 13 }}>
              You have reached the limit of {limit} templates. Delete or edit an existing template.
            </div>
          )}
          <label className="field">
            <span>Template name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Diwali offer" required disabled={limitReached} />
          </label>
          <label className="field">
            <span>Message</span>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder={'Namaste {{name}}, your {{product}} offer price is ₹{{price}}.'}
              disabled={limitReached}
            />
            <small style={{ color: '#6a756e' }}>
              Use {'{{column}}'} for values from Excel, e.g. {'{{name}}'}, {'{{village}}'}.
              {formVars.length > 0 && <> Variables: {formVars.map((v) => `{{${v}}}`).join(', ')}</>}
            </small>
          </label>
          <div className="field">
            <span>Image (optional)</span>
            {renderAttachment(form.imageName, 'image')}
          </div>
          <div className="field">
            <span>File (optional) — PDF, video, Word, Excel…</span>
            {renderAttachment(form.fileName, 'file')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={saving || Boolean(uploading) || limitReached}>
              {saving ? 'Saving…' : (editingId ? 'Update template' : 'Create template')}
            </button>
            {editingId && <button className="btn light" type="button" onClick={resetForm}>Cancel</button>}
            {(form.body || form.imageName || form.fileName) && (
              <button className="btn light" type="button" onClick={() => setPreviewTemplate({ ...form, name: form.name || 'Template preview' })}>
                <i className="bi bi-eye" /> Preview
              </button>
            )}
          </div>
        </form>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>My templates</h3>
          {templates.length === 0 && <p style={{ color: '#6a756e', fontSize: 13 }}>No templates yet. Create up to {limit}.</p>}
          {templates.map((template) => (
            <div
              key={template.id}
              style={{
                border: `1px solid ${template.id === selectedId ? '#157a54' : '#e3e8e4'}`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <strong>{template.name}</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn" type="button" style={{ padding: '4px 10px' }} onClick={() => setSelectedId(template.id)}>Use</button>
                  <button className="btn light" type="button" style={{ padding: '4px 10px' }} onClick={() => setPreviewTemplate(template)}><i className="bi bi-eye" /> Preview</button>
                  <button className="btn light" type="button" style={{ padding: '4px 10px' }} onClick={() => edit(template)}>Edit</button>
                  <button className="btn danger" type="button" style={{ padding: '4px 10px' }} onClick={() => remove(template)}>Delete</button>
                </div>
              </div>
              {template.body && (
                <div style={{ color: '#4a554e', fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 6 }}>
                  {template.body.length > 160 ? `${template.body.slice(0, 160)}…` : template.body}
                </div>
              )}
              <div style={{ color: '#6a756e', fontSize: 12, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {template.imageName && <span><i className="bi bi-image" /> {fileLabel(template.imageName)}</span>}
                {template.fileName && <span><i className="bi bi-paperclip" /> {fileLabel(template.fileName)}</span>}
                {template.variables.length > 0 && <span>Vars: {template.variables.map((v) => `{{${v}}}`).join(', ')}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid templates-grid" style={{ gridTemplateColumns: '1.1fr 0.9fr', marginTop: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Send using template</h3>
          <label className="field">
            <span>Template</span>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {templates.length === 0 && <option value="">No templates</option>}
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Device</span>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.length === 0 && <option value="">No connected devices</option>}
              {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Campaign name (optional)</span>
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder={selected ? `Template: ${selected.name}` : ''} />
          </label>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Contacts (Excel)</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <ContactGroupPicker onPick={loadFromContacts} disabled={sending} />
                <button type="button" className="btn light" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => excelRef.current?.click()}>Import Excel</button>
              </div>
            </div>
            <input ref={excelRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={importExcel} />
            <small style={{ color: '#6a756e' }}>
              {excelInfo || 'Row 1 = headers: phone, name and one column per template variable.'}
            </small>
            {missingVars.length > 0 && (
              <small style={{ color: '#a23d2f', display: 'block' }}>
                Missing Excel columns: {missingVars.map((v) => `{{${v}}}`).join(', ')}
              </small>
            )}
          </div>
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
          {selected && (
            <div className="field">
              <span>Preview {recipients[0] ? `(${recipients[0].phone})` : ''}</span>
              <div className="logs" style={{ whiteSpace: 'pre-wrap', maxHeight: 'none' }}>
                {selected.imageName && <div><i className="bi bi-image" /> {fileLabel(selected.imageName)}</div>}
                {selected.fileName && <div><i className="bi bi-paperclip" /> {fileLabel(selected.fileName)}</div>}
                {preview || (selected.body ? '' : '(no text)')}
              </div>
            </div>
          )}
          <div className="templates-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={start} disabled={sending || !selected}>Start send</button>
            <button className="btn gold" disabled={!sending || paused} onClick={async () => { await control('/api/pause-stream'); setPaused(true); }}>Pause</button>
            <button className="btn light" disabled={!sending || !paused} onClick={async () => { await control('/api/resume-stream'); setPaused(false); }}>Resume</button>
            <button className="btn danger" disabled={!sending} onClick={async () => { await control('/api/stop-stream'); }}>Stop</button>
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Live log</h3>
          <div className="logs">{logs.length ? logs.map((line, i) => <div key={i}>{line}</div>) : 'Waiting to start...'}</div>
        </div>
      </div>

      {previewTemplate && (
        <div className="tpl-preview-backdrop" onMouseDown={() => setPreviewTemplate(null)}>
          <div className="tpl-preview" onMouseDown={(e) => e.stopPropagation()}>
            <div className="tpl-preview-head">
              <div className="tpl-preview-avatar"><i className="bi bi-person-fill" /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="tpl-preview-title">{previewTemplate.name}</div>
                <div className="tpl-preview-subtitle">
                  {recipients[0] ? `Sample: ${recipients[0].name || recipients[0].phone}` : 'Template preview'}
                </div>
              </div>
              <button type="button" className="tpl-preview-close" onClick={() => setPreviewTemplate(null)} aria-label="Close">×</button>
            </div>
            <div className="tpl-preview-chat">
              {previewTemplate.imageName && (
                <div className="tpl-preview-bubble tpl-preview-media">
                  <img src={fileUrl(previewTemplate.imageName)} alt="" className="tpl-preview-image" />
                  {previewTemplate.body && <div className="tpl-preview-text tpl-preview-caption">{renderPreviewBody(previewTemplate.body)}</div>}
                  <span className="tpl-preview-time">now <i className="bi bi-check2-all" /></span>
                </div>
              )}
              {previewTemplate.fileName && (
                <div className="tpl-preview-bubble">
                  <a className="tpl-preview-file" href={fileUrl(previewTemplate.fileName)} target="_blank" rel="noreferrer">
                    <i className="bi bi-file-earmark-text" />
                    <div style={{ minWidth: 0 }}>
                      <div className="tpl-preview-file-name">{fileLabel(previewTemplate.fileName)}</div>
                      <div className="tpl-preview-file-type">{(previewTemplate.fileName.split('.').pop() || 'file').toUpperCase()}</div>
                    </div>
                  </a>
                  <span className="tpl-preview-time">now <i className="bi bi-check2-all" /></span>
                </div>
              )}
              {previewTemplate.body && !previewTemplate.imageName && (
                <div className="tpl-preview-bubble">
                  <div className="tpl-preview-text">{renderPreviewBody(previewTemplate.body)}</div>
                  <span className="tpl-preview-time">now <i className="bi bi-check2-all" /></span>
                </div>
              )}
            </div>
            <div className="tpl-preview-foot">
              {extractVariables(previewTemplate.body).length > 0 && !recipients[0]
                ? 'Highlighted values are filled from your Excel columns when sending.'
                : 'This is how the message will look in WhatsApp.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Templates;
