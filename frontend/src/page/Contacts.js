import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiJson } from '../api';

const PAGE_SIZE = 50;

const emptyContact = { phone: '', name: '', fields: [], groupIds: [] };

const normalizeHeader = (value) => {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (/^(phone|mobile|whatsapp|contact|number|numbers|mobileno|mobile_no|phone_no|phonenumber|mobile_number|phone_number)$/.test(raw)) return 'phone';
  if (/^(name|full_name|fullname|firstname|first_name|person|contact_name|customer|customer_name)$/.test(raw)) return 'name';
  return raw;
};

const phoneDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
};

const phoneKey = (digits) => (digits.length === 10 ? `91${digits}` : digits);

const parseContactsFile = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { contacts: [], duplicates: 0, invalid: 0, columns: [] };
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (!rows.length) return { contacts: [], duplicates: 0, invalid: 0, columns: [] };

  const headerRow = (rows[0] || []).map((cell) => normalizeHeader(cell));
  const hasHeader = headerRow.some((h) => h.length > 0) && !headerRow.some((h) => phoneDigits(h));
  const keys = hasHeader ? headerRow.map((h, i) => h || `col_${i + 1}`) : null;

  const seen = new Set();
  const contacts = [];
  let duplicates = 0;
  let invalid = 0;

  for (let i = hasHeader ? 1 : 0; i < rows.length; i += 1) {
    const cols = rows[i] || [];
    if (!cols.some((c) => String(c || '').trim())) continue;
    let phone = '';
    let name = '';
    const fields = {};
    if (keys) {
      keys.forEach((key, idx) => {
        const val = String(cols[idx] ?? '').trim();
        if (key === 'phone') phone = phoneDigits(val);
        else if (key === 'name') name = val;
        else if (val) fields[key] = val;
      });
      if (!phone) {
        for (const col of cols) {
          phone = phoneDigits(col);
          if (phone) break;
        }
      }
    } else {
      phone = phoneDigits(cols[0]) || phoneDigits(cols.join(' '));
      name = String(cols[1] ?? '').trim();
    }
    if (!phone) {
      invalid += 1;
      continue;
    }
    const key = phoneKey(phone);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    contacts.push({ phone, name, fields });
  }

  const columns = new Set();
  contacts.forEach((c) => Object.keys(c.fields).forEach((k) => columns.add(k)));
  return { contacts, duplicates, invalid, columns: [...columns] };
};

const toFieldRows = (fields) => Object.entries(fields || {}).map(([key, value]) => ({ key, value }));

const toFieldObject = (rows) => {
  const out = {};
  rows.forEach((row) => {
    const key = String(row.key || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (key && String(row.value || '').trim()) out[key] = row.value;
  });
  return out;
};

const Contacts = () => {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50000);
  const [importBatch, setImportBatch] = useState(2000);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [bulkGroupId, setBulkGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [message, setMessage] = useState('');

  const [contactModal, setContactModal] = useState(null);
  const [contactForm, setContactForm] = useState(emptyContact);
  const [contactError, setContactError] = useState('');
  const [saving, setSaving] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [uploadGroupIds, setUploadGroupIds] = useState([]);
  const [uploadNewGroup, setUploadNewGroup] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef(null);

  const groupName = (id) => groups.find((g) => g.id === id)?.name || '';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadGroups = async () => {
    const { data } = await apiJson('/api/contact-groups');
    if (Array.isArray(data?.groups)) setGroups(data.groups);
  };

  const loadContacts = async (nextPage = page, nextSearch = search, nextGroup = groupId) => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) });
    if (nextSearch.trim()) qs.set('search', nextSearch.trim());
    if (nextGroup) qs.set('groupId', nextGroup);
    const { data } = await apiJson(`/api/contacts?${qs.toString()}`);
    if (Array.isArray(data?.contacts)) {
      setContacts(data.contacts);
      setTotal(data.total || 0);
      if (data.limit) setLimit(data.limit);
      if (data.importBatch) setImportBatch(data.importBatch);
    }
    setSelected([]);
    setLoading(false);
  };

  useEffect(() => {
    loadGroups();
    loadContacts(1, '', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      loadContacts(1, search, groupId);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!contactModal && !uploadOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!importing) setUploadOpen(false);
      setContactModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contactModal, uploadOpen, importing]);

  const refresh = async () => {
    await Promise.all([loadGroups(), loadContacts(page, search, groupId)]);
  };

  const chooseGroup = (id) => {
    setGroupId(id);
    setPage(1);
    loadContacts(1, search, id);
  };

  const goToPage = (next) => {
    setPage(next);
    loadContacts(next, search, groupId);
  };

  const flash = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 4000);
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const { res, data } = await apiJson('/api/contact-groups', { method: 'POST', body: JSON.stringify({ name: newGroupName }) });
    if (!res.ok || !data.success) return alert(data.error || 'Could not create group');
    setNewGroupName('');
    loadGroups();
  };

  const renameGroup = async (group) => {
    const name = window.prompt('New group name', group.name);
    if (!name || name.trim() === group.name) return;
    const { res, data } = await apiJson(`/api/contact-groups/${group.id}`, { method: 'POST', body: JSON.stringify({ name }) });
    if (!res.ok || !data.success) return alert(data.error || 'Could not rename group');
    loadGroups();
  };

  const deleteGroup = async (group) => {
    if (!window.confirm(`Delete group "${group.name}"? Contacts stay saved; only the group is removed.`)) return;
    const { res, data } = await apiJson(`/api/contact-groups/${group.id}/delete`, { method: 'POST' });
    if (!res.ok || !data.success) return alert(data.error || 'Could not delete group');
    if (groupId === group.id) chooseGroup('');
    refresh();
  };

  const openAdd = () => {
    setContactForm({ ...emptyContact, groupIds: groupId ? [groupId] : [] });
    setContactError('');
    setContactModal('add');
  };

  const openEdit = (contact) => {
    setContactForm({ phone: contact.phone, name: contact.name, fields: toFieldRows(contact.fields), groupIds: contact.groupIds || [] });
    setContactError('');
    setContactModal(contact.id);
  };

  const toggleFormGroup = (id) => {
    setContactForm((prev) => ({
      ...prev,
      groupIds: prev.groupIds.includes(id) ? prev.groupIds.filter((g) => g !== id) : [...prev.groupIds, id]
    }));
  };

  const setFieldRow = (index, key, value) => {
    setContactForm((prev) => ({ ...prev, fields: prev.fields.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));
  };

  const saveContact = async (e) => {
    e.preventDefault();
    setContactError('');
    setSaving(true);
    const payload = { ...contactForm, fields: toFieldObject(contactForm.fields) };
    const path = contactModal === 'add' ? '/api/contacts' : `/api/contacts/${contactModal}`;
    const { res, data } = await apiJson(path, { method: 'POST', body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok || !data.success) return setContactError(data.error || 'Save failed');
    setContactModal(null);
    refresh();
  };

  const deleteIds = async (ids) => {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} contact${ids.length > 1 ? 's' : ''}?`)) return;
    const { res, data } = await apiJson('/api/contacts/delete', { method: 'POST', body: JSON.stringify({ ids }) });
    if (!res.ok || !data.success) return alert(data.error || 'Delete failed');
    flash(`${data.deleted} contact(s) deleted.`);
    refresh();
  };

  const addSelectedToGroup = async () => {
    if (!bulkGroupId || !selected.length) return;
    const { res, data } = await apiJson(`/api/contact-groups/${bulkGroupId}/add`, { method: 'POST', body: JSON.stringify({ contactIds: selected }) });
    if (!res.ok || !data.success) return alert(data.error || 'Could not add to group');
    flash(`${data.added} contact(s) added to "${groupName(bulkGroupId)}".`);
    setBulkGroupId('');
    refresh();
  };

  const removeSelectedFromGroup = async () => {
    if (!groupId || !selected.length) return;
    const { res, data } = await apiJson(`/api/contact-groups/${groupId}/remove`, { method: 'POST', body: JSON.stringify({ contactIds: selected }) });
    if (!res.ok || !data.success) return alert(data.error || 'Could not remove from group');
    flash(`${data.removed} contact(s) removed from "${groupName(groupId)}".`);
    refresh();
  };

  const exportExcel = async () => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (groupId) qs.set('groupId', groupId);
    const { data } = await apiJson(`/api/contacts/export?${qs.toString()}`);
    const list = Array.isArray(data?.contacts) ? data.contacts : [];
    if (!list.length) return alert('No contacts to export.');
    const rows = list.map((c) => ({
      phone: c.phone,
      name: c.name,
      ...c.fields,
      groups: (c.groupIds || []).map(groupName).filter(Boolean).join(', ')
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Contacts');
    const label = groupId ? groupName(groupId).replace(/[^\w-]+/g, '_') : 'all';
    XLSX.writeFile(book, `contacts_${label}.xlsx`);
  };

  const openUpload = () => {
    setParsed(null);
    setFileName('');
    setUploadGroupIds(groupId ? [groupId] : []);
    setUploadNewGroup('');
    setUploadResult(null);
    setUploadError('');
    setProgress(0);
    setUploadOpen(true);
  };

  const readFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadError('');
    setUploadResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseContactsFile(reader.result);
        if (!result.contacts.length) {
          setParsed(null);
          setUploadError('No valid phone numbers found in this file.');
          return;
        }
        setParsed(result);
        setFileName(file.name);
      } catch (err) {
        setUploadError(err.message || 'Could not read that file.');
      }
    };
    reader.onerror = () => setUploadError('Could not read that file.');
    reader.readAsArrayBuffer(file);
  };

  const toggleUploadGroup = (id) => {
    setUploadGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const startImport = async () => {
    if (!parsed?.contacts.length) return;
    setImporting(true);
    setUploadError('');
    setProgress(0);
    const totals = { added: 0, updated: 0, duplicates: parsed.duplicates, invalid: parsed.invalid, skippedByLimit: 0 };
    let targetGroups = [...uploadGroupIds];
    let newGroup = uploadNewGroup.trim();
    try {
      for (let start = 0; start < parsed.contacts.length; start += importBatch) {
        const part = parsed.contacts.slice(start, start + importBatch);
        const { res, data } = await apiJson('/api/contacts/import', {
          method: 'POST',
          body: JSON.stringify({ contacts: part, groupIds: targetGroups, newGroupName: newGroup })
        });
        if (!res.ok || !data.success) throw new Error(data.error || 'Import failed');
        totals.added += data.added;
        totals.updated += data.updated;
        totals.duplicates += data.duplicates;
        totals.invalid += data.invalid;
        totals.skippedByLimit += data.skippedByLimit;
        targetGroups = data.groupIds || targetGroups;
        newGroup = '';
        setProgress(Math.round(((start + part.length) / parsed.contacts.length) * 100));
      }
      setUploadResult(totals);
      setParsed(null);
      refresh();
    } catch (err) {
      setUploadError(err.message);
      refresh();
    } finally {
      setImporting(false);
    }
  };

  const allSelected = contacts.length > 0 && contacts.every((c) => selected.includes(c.id));
  const toggleAll = () => setSelected(allSelected ? [] : contacts.map((c) => c.id));
  const toggleOne = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allCount = groupId ? null : total;

  return (
    <div className="contacts-page">
      <div className="contacts-layout">
        <aside className="card contacts-groups">
          <h3 style={{ marginTop: 0 }}>Groups</h3>
          <button type="button" className={`contacts-group-item ${groupId === '' ? 'active' : ''}`} onClick={() => chooseGroup('')}>
            <span><i className="bi bi-people" /> All contacts</span>
            {allCount != null && <span className="contacts-count">{allCount}</span>}
          </button>
          {groups.map((group) => (
            <div key={group.id} className={`contacts-group-item ${groupId === group.id ? 'active' : ''}`}>
              <button type="button" className="contacts-group-name" onClick={() => chooseGroup(group.id)}>
                <i className="bi bi-collection" /> {group.name}
              </button>
              <span className="contacts-count">{group.count}</span>
              <button type="button" className="contacts-icon-btn" title="Rename" onClick={() => renameGroup(group)}><i className="bi bi-pencil" /></button>
              <button type="button" className="contacts-icon-btn danger" title="Delete group" onClick={() => deleteGroup(group)}><i className="bi bi-trash" /></button>
            </div>
          ))}
          {groups.length === 0 && <p style={{ color: '#6a756e', fontSize: 13 }}>No groups yet.</p>}
          <form onSubmit={createGroup} className="contacts-new-group">
            <i className="bi bi-folder-plus" />
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="New group name" maxLength={120} />
            <button type="submit" disabled={!newGroupName.trim()} title="Create group"><i className="bi bi-plus-lg" /></button>
          </form>
        </aside>

        <section className="card contacts-main">
          <div className="contacts-toolbar">
            <div className="contacts-search">
              <i className="bi bi-search" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search phone, name or details" />
              {search && (
                <button type="button" className="contacts-search-clear" onClick={() => setSearch('')} title="Clear search"><i className="bi bi-x-lg" /></button>
              )}
            </div>
            <div className="contacts-toolbar-right">
              <button className="btn light" type="button" onClick={exportExcel}><i className="bi bi-download" /> Export</button>
              <button className="btn light" type="button" onClick={openAdd}><i className="bi bi-person-plus" /> Add contact</button>
              <button className="btn" type="button" onClick={openUpload}><i className="bi bi-upload" /> Upload list</button>
            </div>
          </div>

          <div className="contacts-subbar">
            <strong>{groupId ? groupName(groupId) : 'All contacts'}</strong>
            <span>{total} contact{total === 1 ? '' : 's'}{!groupId && ` · limit ${limit.toLocaleString()}`}</span>
            {message && <span className="contacts-flash">{message}</span>}
          </div>

          {selected.length > 0 && (
            <div className="contacts-bulk">
              <span>{selected.length} selected</span>
              <select value={bulkGroupId} onChange={(e) => setBulkGroupId(e.target.value)}>
                <option value="">Add to group…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button className="btn light" type="button" disabled={!bulkGroupId} onClick={addSelectedToGroup}>Add</button>
              {groupId && <button className="btn light" type="button" onClick={removeSelectedFromGroup}>Remove from this group</button>}
              <button className="btn danger" type="button" onClick={() => deleteIds(selected)}>Delete</button>
            </div>
          )}

          <div className="contacts-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                  <th>Phone</th>
                  <th>Name</th>
                  <th>Details</th>
                  <th>Groups</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td><input type="checkbox" checked={selected.includes(contact.id)} onChange={() => toggleOne(contact.id)} aria-label={`Select ${contact.phone}`} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>+{contact.phone}</td>
                    <td>{contact.name || <span style={{ color: '#6a756e' }}>-</span>}</td>
                    <td className="contacts-details">
                      {Object.entries(contact.fields).map(([key, value]) => <span key={key}><b>{key}:</b> {value}</span>)}
                    </td>
                    <td>
                      <div className="contacts-chips">
                        {(contact.groupIds || []).map((id) => groupName(id) && <span key={id} className="contacts-chip">{groupName(id)}</span>)}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="contacts-icon-btn" type="button" title="Edit" onClick={() => openEdit(contact)}><i className="bi bi-pencil" /></button>
                      <button className="contacts-icon-btn danger" type="button" title="Delete" onClick={() => deleteIds([contact.id])}><i className="bi bi-trash" /></button>
                    </td>
                  </tr>
                ))}
                {!loading && contacts.length === 0 && (
                  <tr><td colSpan="6" style={{ textAlign: 'center', color: '#6a756e', padding: 28 }}>
                    {search || groupId ? 'No contacts match.' : 'No contacts yet. Click "Upload list" to import your customer numbers.'}
                  </td></tr>
                )}
                {loading && contacts.length === 0 && <tr><td colSpan="6">Loading…</td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="contacts-pager">
              <button className="btn light" type="button" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>‹ Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button className="btn light" type="button" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>Next ›</button>
            </div>
          )}
        </section>
      </div>

      {uploadOpen && (
        <div className="contacts-modal-backdrop" onMouseDown={() => { if (!importing) setUploadOpen(false); }}>
          <div className="card contacts-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="contacts-modal-head">
              <div>
                <h3 style={{ margin: 0 }}>Upload your contact list</h3>
                <small style={{ color: '#6a756e' }}>Import customer numbers in one go and organise them into groups.</small>
              </div>
              <button type="button" className="contacts-modal-close" disabled={importing} onClick={() => setUploadOpen(false)} aria-label="Close">×</button>
            </div>

            {!uploadResult && (
              <>
                <button type="button" className="contacts-drop" onClick={() => fileRef.current?.click()} disabled={importing}>
                  <i className="bi bi-file-earmark-spreadsheet" />
                  <strong>{fileName || 'Choose Excel or CSV file'}</strong>
                  <span>Row 1 = headers: phone, name and any extra columns (city, product…)</span>
                </button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={readFile} />

                {parsed && (
                  <div className="contacts-summary">
                    <div><b>{parsed.contacts.length}</b> valid numbers</div>
                    {parsed.duplicates > 0 && <div>{parsed.duplicates} duplicates removed</div>}
                    {parsed.invalid > 0 && <div>{parsed.invalid} rows skipped (no valid number)</div>}
                    {parsed.columns.length > 0 && <div>Extra columns: {parsed.columns.join(', ')}</div>}
                  </div>
                )}

                {parsed && (
                  <div className="contacts-preview">
                    <table className="table">
                      <thead><tr><th>Phone</th><th>Name</th><th>Details</th></tr></thead>
                      <tbody>
                        {parsed.contacts.slice(0, 5).map((c) => (
                          <tr key={c.phone}>
                            <td>{c.phone}</td>
                            <td>{c.name || '-'}</td>
                            <td>{Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.contacts.length > 5 && <small style={{ color: '#6a756e' }}>…and {parsed.contacts.length - 5} more</small>}
                  </div>
                )}

                <div className="field" style={{ marginTop: 14 }}>
                  <span>Add these contacts to groups (optional)</span>
                  {groups.length > 0 && (
                    <div className="contacts-check-list">
                      {groups.map((g) => (
                        <label key={g.id}>
                          <input type="checkbox" checked={uploadGroupIds.includes(g.id)} onChange={() => toggleUploadGroup(g.id)} disabled={importing} />
                          {g.name}
                        </label>
                      ))}
                    </div>
                  )}
                  <input
                    value={uploadNewGroup}
                    onChange={(e) => setUploadNewGroup(e.target.value)}
                    placeholder="Or create a new group, e.g. Diwali 2026"
                    maxLength={120}
                    disabled={importing}
                    style={{ marginTop: 8 }}
                  />
                </div>

                {importing && (
                  <div className="contacts-progress"><div style={{ width: `${progress}%` }} /><span>{progress}%</span></div>
                )}
                {uploadError && <div style={{ color: '#a23d2f', marginTop: 10 }}>{uploadError}</div>}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                  <button className="btn light" type="button" disabled={importing} onClick={() => setUploadOpen(false)}>Cancel</button>
                  <button className="btn" type="button" disabled={!parsed || importing} onClick={startImport}>
                    {importing ? 'Importing…' : `Import ${parsed ? parsed.contacts.length : ''} contacts`}
                  </button>
                </div>
              </>
            )}

            {uploadResult && (
              <div>
                <div className="contacts-result">
                  <i className="bi bi-check-circle-fill" />
                  <div>
                    <strong>Import complete</strong>
                    <div>{uploadResult.added} new contacts added</div>
                    {uploadResult.updated > 0 && <div>{uploadResult.updated} existing contacts updated</div>}
                    {uploadResult.duplicates > 0 && <div>{uploadResult.duplicates} duplicates skipped</div>}
                    {uploadResult.invalid > 0 && <div>{uploadResult.invalid} invalid numbers skipped</div>}
                    {uploadResult.skippedByLimit > 0 && <div style={{ color: '#a23d2f' }}>{uploadResult.skippedByLimit} not saved — contact limit reached</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                  <button className="btn light" type="button" onClick={openUpload}>Upload another</button>
                  <button className="btn" type="button" onClick={() => setUploadOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {contactModal && (
        <div className="contacts-modal-backdrop" onMouseDown={() => setContactModal(null)}>
          <form className="card contacts-modal" onSubmit={saveContact} onMouseDown={(e) => e.stopPropagation()}>
            <div className="contacts-modal-head">
              <h3 style={{ margin: 0 }}>{contactModal === 'add' ? 'Add contact' : 'Edit contact'}</h3>
              <button type="button" className="contacts-modal-close" onClick={() => setContactModal(null)} aria-label="Close">×</button>
            </div>
            {contactError && <div style={{ color: '#a23d2f', marginBottom: 12 }}>{contactError}</div>}
            <label className="field">
              <span>Phone (with country code, or 10-digit Indian number)</span>
              <input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="9876543210" required />
            </label>
            <label className="field">
              <span>Name</span>
              <input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="Ravi Patel" maxLength={200} />
            </label>
            <div className="field">
              <span>Extra details (used as {'{{variables}}'} later)</span>
              {contactForm.fields.map((row, index) => (
                <div key={index} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input value={row.key} onChange={(e) => setFieldRow(index, 'key', e.target.value)} placeholder="city" style={{ flex: 1, minWidth: 0 }} />
                  <input value={row.value} onChange={(e) => setFieldRow(index, 'value', e.target.value)} placeholder="Surat" style={{ flex: 2, minWidth: 0 }} />
                  <button type="button" className="btn danger" style={{ padding: '4px 10px' }} onClick={() => setContactForm((prev) => ({ ...prev, fields: prev.fields.filter((_, i) => i !== index) }))}>×</button>
                </div>
              ))}
              <button type="button" className="btn light" style={{ padding: '4px 10px', fontSize: 12, marginTop: 6, alignSelf: 'flex-start' }} onClick={() => setContactForm((prev) => ({ ...prev, fields: [...prev.fields, { key: '', value: '' }] }))}>
                + Add detail
              </button>
            </div>
            {groups.length > 0 && (
              <div className="field">
                <span>Groups</span>
                <div className="contacts-check-list">
                  {groups.map((g) => (
                    <label key={g.id}>
                      <input type="checkbox" checked={contactForm.groupIds.includes(g.id)} onChange={() => toggleFormGroup(g.id)} />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn light" type="button" onClick={() => setContactModal(null)}>Cancel</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Contacts;
