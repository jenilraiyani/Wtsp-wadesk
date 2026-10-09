import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../api';

const formatTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};

const AutomationLogs = () => {
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [ruleId, setRuleId] = useState('');
  const [loading, setLoading] = useState(false);

  const loadLogs = async (id = ruleId) => {
    setLoading(true);
    const qs = id ? `&ruleId=${encodeURIComponent(id)}` : '';
    const { data } = await apiJson(`/api/automation/logs?limit=500${qs}`);
    if (Array.isArray(data?.logs)) setLogs(data.logs);
    setLoading(false);
  };

  useEffect(() => {
    apiJson('/api/automation/rules').then(({ data }) => {
      if (Array.isArray(data?.rules)) setRules(data.rules);
    });
    loadLogs('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeFilter = (value) => {
    setRuleId(value);
    loadLogs(value);
  };

  return (
    <div className="automation-page">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>All execution logs ({logs.length})</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={ruleId} onChange={(e) => changeFilter(e.target.value)} style={{ padding: '6px 10px' }}>
              <option value="">All rules</option>
              {rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
            </select>
            <button className="btn light" type="button" onClick={() => loadLogs()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <Link className="btn light" to="/automation">← Back to Automation</Link>
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

export default AutomationLogs;
