import React, { useEffect, useState } from 'react';
import { apiJson } from '../api';

const ContactGroupPicker = ({ onPick, disabled }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiJson('/api/contact-groups').then(({ data }) => {
      if (Array.isArray(data?.groups)) setGroups(data.groups);
    }).catch(() => {});
  }, []);

  const pick = async (event) => {
    const value = event.target.value;
    event.target.value = '';
    if (!value) return;
    const groupId = value === 'all' ? '' : value;
    const label = groupId ? groups.find((g) => g.id === groupId)?.name || 'group' : 'All contacts';
    setLoading(true);
    try {
      const qs = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
      const { data } = await apiJson(`/api/contacts/export${qs}`);
      const list = Array.isArray(data?.contacts) ? data.contacts : [];
      const vars = new Set();
      const recipients = list.map((c) => {
        const row = { phone: c.phone };
        if (c.name) {
          row.name = c.name;
          vars.add('name');
        }
        Object.entries(c.fields || {}).forEach(([key, val]) => {
          if (key === 'phone') return;
          row[key] = val;
          vars.add(key);
        });
        return row;
      });
      onPick({ recipients, vars: [...vars], label });
    } finally {
      setLoading(false);
    }
  };

  return (
    <select
      defaultValue=""
      onChange={pick}
      disabled={disabled || loading}
      title="Load numbers from your saved contacts"
      style={{ padding: '4px 8px', fontSize: 12, width: 'auto', maxWidth: 190 }}
    >
      <option value="">{loading ? 'Loading…' : 'From contacts…'}</option>
      <option value="all">All contacts</option>
      {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.count})</option>)}
    </select>
  );
};

export default ContactGroupPicker;
