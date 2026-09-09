import { useState, useEffect } from 'react';
import { DB } from '../lib/db.js';

function MiniProgressBar({ correct, incorrect, total }) {
  const pctC = total ? Math.round((correct   / total) * 100) : 0;
  const pctI = total ? Math.round((incorrect / total) * 100) : 0;
  const untested = total - correct - incorrect;
  return (
    <div>
      <div style={{ display:'flex', height:7, borderRadius:50, overflow:'hidden',
        background:'var(--border)', marginBottom:4, minWidth:80 }}>
        <div style={{ width:`${pctC}%`, background:'var(--secondary)', transition:'width 0.4s' }} />
        <div style={{ width:`${pctI}%`, background:'var(--danger)',    transition:'width 0.4s' }} />
      </div>
      <div style={{ display:'flex', gap:8, fontSize:'0.72rem', color:'var(--text-muted)' }}>
        <span style={{ color:'var(--secondary)', fontWeight:600 }}>✔ {correct}</span>
        <span style={{ color:'var(--danger)',    fontWeight:600 }}>✘ {incorrect}</span>
        <span>{untested} untested</span>
      </div>
    </div>
  );
}

export default function AdminOverview() {
  const [rows,    setRows]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true); setError('');
    DB.wordLists.getAdminOverview()
      .then(setRows)
      .catch(e => setError(e.message || 'Could not load overview.'))
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading) return (
    <div className="card" style={{ marginBottom: 24, textAlign: 'center', padding: 32 }}>
      <div className="spinner" style={{ margin: '0 auto 12px' }} />
      <p>Loading overview…</p>
    </div>
  );

  if (error) return (
    <div className="card" style={{ marginBottom: 24 }}>
      <p style={{ color: 'var(--danger)' }}>⚠️ {error}</p>
    </div>
  );

  if (!rows || rows.length === 0) return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginBottom: 8 }}>📊 Overview</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        No children registered yet.
      </p>
    </div>
  );

  // Aggregate stats
  const totalFamilies = new Set(rows.map(r => r.parent_name)).size;
  const totalChildren = rows.length;
  const totalCorrect  = rows.reduce((s, r) => s + Number(r.correct),     0);
  const totalIncorrect= rows.reduce((s, r) => s + Number(r.incorrect),   0);

  const filtered = rows.filter(r =>
    !search ||
    r.child_name.toLowerCase().includes(search.toLowerCase()) ||
    r.parent_name.toLowerCase().includes(search.toLowerCase()) ||
    (r.active_list_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display:'flex', alignItems:'center',
        justifyContent:'space-between', marginBottom:16 }}>
        <h3>📊 Overview</h3>
        <button className="btn btn-ghost btn-sm"
          onClick={() => setRefresh(n => n + 1)} disabled={loading}
          title="Refresh overview">
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* Aggregate counts */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {[
          { label:'Families',   value: totalFamilies, color:'var(--primary)' },
          { label:'Children',   value: totalChildren, color:'var(--primary)' },
          { label:'Correct',    value: totalCorrect,  color:'var(--secondary)' },
          { label:'Incorrect',  value: totalIncorrect,color:'var(--danger)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ flex:'1 1 100px', padding:'12px 14px',
            textAlign:'center', boxShadow:'none', border:'1px solid var(--border)' }}>
            <div style={{ fontSize:'1.4rem', fontWeight:700, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', fontWeight:600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input className="input" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Filter by child, parent, or list…"
        style={{ marginBottom: 12, fontSize: '0.88rem' }} />

      {/* Per-family table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
          <thead>
            <tr style={{ background:'#f0f0fa', textAlign:'left' }}>
              {['Family','Child','Active List','Progress'].map(h => (
                <th key={h} style={{ padding:'8px 10px', border:'1px solid var(--border)',
                  fontWeight:600, color:'var(--text)', whiteSpace:'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const correct    = Number(r.correct);
              const incorrect  = Number(r.incorrect);
              const total      = Number(r.total_words);
              return (
                <tr key={r.child_id} style={{ borderBottom:'1px solid var(--border)' }}>
                  <td style={{ padding:'8px 10px', color:'var(--text-muted)' }}>
                    {r.parent_name}
                  </td>
                  <td style={{ padding:'8px 10px', fontWeight:600 }}>
                    {r.child_name}
                  </td>
                  <td style={{ padding:'8px 10px', color: r.active_list_name ? 'var(--text)' : 'var(--text-muted)' }}>
                    {r.active_list_name || '—'}
                  </td>
                  <td style={{ padding:'8px 10px', minWidth: 180 }}>
                    {total > 0
                      ? <MiniProgressBar correct={correct} incorrect={incorrect} total={total} />
                      : <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>No list assigned</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p style={{ textAlign:'center', color:'var(--text-muted)',
            fontSize:'0.88rem', padding:'16px 0' }}>No results for "{search}"</p>
        )}
      </div>
    </div>
  );
}
