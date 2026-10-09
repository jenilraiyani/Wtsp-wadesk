import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../api';

const History = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const logCardRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    apiJson(`/api/campaigns${qs}`).then(({ data }) => {
      const list = data.campaigns || [];
      setCampaigns(list);
      if (active && !list.some((item) => item.id === active)) {
        setActive(null);
        setLogs([]);
      }
    });
  }, [query]);

  const openLogs = async (id) => {
    setActive(id);
    const { data } = await apiJson(`/api/campaigns/${id}/logs`);
    setLogs(data.logs || []);
    if (window.matchMedia('(max-width: 900px)').matches) {
      logCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const filteredLogs = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return logs;
    const digits = q.replace(/\D/g, '');
    return logs.filter((row) => {
      const hay = `${row.status || ''} ${row.number || ''} ${row.error || ''}`.toLowerCase();
      if (hay.includes(q)) return true;
      if (digits && String(row.number || '').includes(digits)) return true;
      return false;
    });
  }, [logs, query]);

  return (
    <div className="history-page">
      <div className="card" style={{ marginBottom: 16 }}>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Search history</span>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by campaign name, device, number, status, error…"
          />
        </label>
      </div>
      <div className="grid history-grid" style={{ gridTemplateColumns: '1.1fr 0.9fr' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Saved in SQL Server</h3>
          <div className="history-table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Status</th><th>Result</th><th /></tr>
            </thead>
            <tbody>
              {campaigns.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}<div style={{ color: '#6a756e', fontSize: 12 }}>{item.deviceId}</div></td>
                  <td><span className={`status ${item.status === 'completed' ? 'on' : 'wait'}`}>{item.status}</span></td>
                  <td>{item.sentCount}/{item.totalCount} · {item.failedCount} fail</td>
                  <td><button className="btn light" onClick={() => openLogs(item.id)}>Logs</button></td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan="4">{query ? 'No matching campaigns.' : 'No campaign history yet.'}</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
        <div className="card" ref={logCardRef}>
          <h3 style={{ marginTop: 0 }}>{active ? 'Delivery log' : 'Select a campaign'}</h3>
          <div className="logs">
            {filteredLogs.map((row, i) => (
              <div key={i}>{row.status} {row.number} {row.error || ''}</div>
            ))}
            {active && filteredLogs.length === 0 && (
              <div>{query ? 'No matching log lines.' : 'No logs for this campaign.'}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default History;
