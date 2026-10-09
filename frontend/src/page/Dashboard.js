import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../api';

const barHeight = (value, max) => `${Math.max(value > 0 ? 8 : 2, (value / max) * 100)}%`;

const WeeklyChart = ({ days }) => {
  const max = Math.max(1, ...days.map((day) => Math.max(day.sent, day.failed)));
  const hasData = days.some((day) => day.sent > 0 || day.failed > 0);

  return (
    <div className="card weekly-card">
      <div className="weekly-head">
        <div>
          <h3>Last 7 days</h3>
          <p>Messages sent vs failed</p>
        </div>
        <div className="weekly-legend">
          <span><i className="dot sent" /> Sent</span>
          <span><i className="dot failed" /> Failed</span>
        </div>
      </div>
      <div className="weekly-chart" role="img" aria-label="Sent versus failed messages for the last 7 days">
        {days.map((day) => (
          <div className="weekly-col" key={day.date}>
            <div className="weekly-bars">
              <div
                className="weekly-bar sent"
                style={{ height: barHeight(day.sent, max) }}
                title={`${day.label}: ${day.sent} sent`}
              >
                {day.sent > 0 ? <span>{day.sent}</span> : null}
              </div>
              <div
                className="weekly-bar failed"
                style={{ height: barHeight(day.failed, max) }}
                title={`${day.label}: ${day.failed} failed`}
              >
                {day.failed > 0 ? <span>{day.failed}</span> : null}
              </div>
            </div>
            <span className="weekly-label">{day.label}</span>
          </div>
        ))}
      </div>
      {!hasData && <p className="weekly-empty">No campaign sends in the last 7 days.</p>}
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);

  useEffect(() => {
    apiJson('/api/stats').then(({ data }) => setStats(data.stats || null));
    apiJson('/api/campaigns').then(({ data }) => setCampaigns(data.campaigns || []));
  }, []);

  const weekly = useMemo(() => {
    if (Array.isArray(stats?.weekly) && stats.weekly.length === 7) return stats.weekly;
    return [];
  }, [stats]);

  const cards = [
    { label: 'Linked devices', value: stats?.totalDevices ?? '—', extra: `${stats?.connectedDevices ?? 0} live` },
    { label: 'Sent today', value: stats?.sentToday ?? '—', extra: 'Last 24 hours' },
    { label: 'Campaigns', value: stats?.totalCampaigns ?? '—', extra: `${stats?.campaignsToday ?? 0} today` },
    { label: 'Failed total', value: stats?.messagesFailed ?? '—', extra: 'Needs review' }
  ];

  return (
    <div className="dashboard">
      <div className="grid stats" style={{ marginBottom: 20 }}>
        {cards.map((card) => (
          <div className="card" key={card.label}>
            <div className="stat-label">{card.label}</div>
            <div className="stat-value">{card.value}</div>
            <div style={{ color: '#6a756e', marginTop: 6 }}>{card.extra}</div>
          </div>
        ))}
      </div>
      {weekly.length === 7 && <WeeklyChart days={weekly} />}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Recent campaigns</h3>
          <Link to="/campaigns" className="btn light">New campaign</Link>
        </div>
        <div className="dash-table-wrap">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Device</th><th>Status</th><th>Sent</th><th>Failed</th></tr>
          </thead>
          <tbody>
            {campaigns.slice(0, 5).map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.deviceId || '—'}</td>
                <td><span className={`status ${item.status === 'completed' ? 'on' : item.status === 'failed' || item.status === 'aborted' ? 'off' : 'wait'}`}>{item.status}</span></td>
                <td>{item.sentCount}/{item.totalCount}</td>
                <td>{item.failedCount}</td>
              </tr>
            ))}
            {campaigns.length === 0 && <tr><td colSpan="5">No campaigns stored yet. Run one from Campaigns.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
