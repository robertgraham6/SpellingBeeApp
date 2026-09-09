import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { DB } from '../lib/db.js';
import Layout from '../components/Layout.jsx';

// Parses the exported progress Excel/CSV and maps source_id → { status, rating }
function parseProgressFile(data) {
  if (!data || data.length < 2) return null;
  const header = data[0].map(h => String(h).toLowerCase().trim());
  const idx = {
    sourceId: header.findIndex(h => h.includes('word_id') || h.includes('source_id') || h === 'id'),
    status:   header.findIndex(h => h === 'status' || h.includes('result')),
    rating:   header.findIndex(h => h === 'rating' || h.includes('difficulty') || h.includes('stars')),
    normWord: header.findIndex(h => h.includes('normalized_word') || h === 'normalizedword'),
    normPron: header.findIndex(h => h.includes('normalized_pronunciation') || h === 'normalizedpron'),
  };
  const col = (row, i) => i > -1 ? String(row[i] || '').trim() : '';
  const validStatuses = new Set(['correct', 'incorrect', 'untested']);
  const entries = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row.some(Boolean)) continue;
    const sourceId = col(row, idx.sourceId);
    const rawStatus = col(row, idx.status).toLowerCase();
    const status = validStatuses.has(rawStatus) ? rawStatus : null;
    const rating = col(row, idx.rating) ? Number(col(row, idx.rating)) : null;
    const normWord = col(row, idx.normWord);
    const normPron = col(row, idx.normPron);
    if (sourceId || normWord) {
      entries.push({ sourceId, normWord, normPron, status, rating });
    }
  }
  return entries.length ? entries : null;
}

export default function ImportProgress() {
  const { childList, activeChild, wordList } = useApp();
  const [selectedChildId, setSelectedChildId] = useState('');
  const [entries, setEntries]     = useState(null);
  const [fileName, setFileName]   = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState('');
  const [error, setError]         = useState('');
  const fileRef = useRef();

  const targetChildId = selectedChildId || activeChild?.id || '';
  const targetChild   = childList.find(c => c.id === targetChildId) || activeChild;

  async function handleFile(file) {
    if (!file) return;
    setError(''); setEntries(null); setResult(''); setFileName(file.name);
    const name = file.name.toLowerCase();
    const process = (data) => {
      const parsed = parseProgressFile(data);
      if (!parsed) return setError('No valid entries found. Make sure the file has id/status/rating columns.');
      setEntries(parsed);
    };
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = async e => {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(e.target.result);
        const ws = wb.worksheets[0];
        const rows = [];
        ws.eachRow(row => rows.push(row.values.slice(1)));
        process(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target.result;
        const delim = text.split('\n')[0].includes(',') ? ',' : '|';
        const rows = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
          .map(l => l.split(delim).map(v => v.trim().replace(/^"|"$/g,'')));
        process(rows);
      };
      reader.readAsText(file);
    }
  }

  async function handleImport() {
    if (!entries || !targetChildId) return;
    setImporting(true); setError(''); setResult('');
    try {
      // Build a lookup: sourceId → wordId, and normKey → wordId from current wordList
      const sourceMap = {};
      const normMap   = {};
      wordList.forEach(w => {
        if (w.id)              sourceMap[String(w.id)] = w.wordId;
        if (w.normalizedWord)  {
          const key = w.normalizedPronunciation
            ? `${w.normalizedWord}_${w.normalizedPronunciation}`
            : w.normalizedWord;
          normMap[key] = w.wordId;
        }
      });

      const toImport = entries.map(e => {
        const wordId = sourceMap[e.sourceId]
          || normMap[e.normPron ? `${e.normWord}_${e.normPron}` : e.normWord];
        return { wordId, status: e.status, rating: e.rating };
      }).filter(e => e.wordId && (e.status || (e.rating >= 2 && e.rating <= 5)));

      if (!toImport.length) {
        setError('No entries could be matched to words in the current word list. Make sure the correct child is selected and they have an active word list.');
        setImporting(false);
        return;
      }

      await DB.history.bulkImportProgress(targetChildId, toImport);
      const statusCount = toImport.filter(e => e.status).length;
      const ratingCount = toImport.filter(e => e.rating).length;
      setResult(`✅ Imported progress for ${toImport.length} words — ${statusCount} status updates, ${ratingCount} rating updates.`);
      setEntries(null);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError('Import failed: ' + e.message);
    } finally { setImporting(false); }
  }

  return (
    <Layout>
      <h1 style={{ marginBottom: 6 }}>Import Progress</h1>
      <p style={{ marginBottom: 28 }}>
        Upload an exported progress file to update a child's correct/incorrect status and ratings.
      </p>

      {/* Child selector */}
      {childList.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Select child</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {childList.map(c => (
              <button key={c.id}
                className={`btn btn-sm ${targetChildId === c.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSelectedChildId(c.id)}>
                {c.avatar} {c.name}
              </button>
            ))}
          </div>
          {targetChild && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Progress will be applied to <strong>{targetChild.name}</strong>'s current active word list.
              Make sure they have a word list assigned before importing.
            </p>
          )}
        </div>
      )}

      {/* File upload */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Upload progress file</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          Accepts the Excel file exported from the <strong>Review</strong> page. Required columns:
        </p>
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 16px',
          fontSize: '0.82rem', fontFamily: 'monospace', marginBottom: 16,
          border: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Minimum columns needed:</div>
          <div><strong>Word ID</strong> — the source_id / row number from the original import</div>
          <div><strong>status</strong> — correct, incorrect, or untested</div>
          <div><strong>rating</strong> — 2, 3, 4, or 5 (optional)</div>
          <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>
            Or use: <strong>normalized_word</strong> + <strong>normalized_pronunciation</strong> instead of Word ID
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
          Choose File
        </button>
        {fileName && (
          <p style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            📄 {fileName}
          </p>
        )}
      </div>

      {/* Preview */}
      {entries && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Preview</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Found <strong>{entries.length}</strong> entries —{' '}
            {entries.filter(e => e.status).length} with status,{' '}
            {entries.filter(e => e.rating).length} with rating.
          </p>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 16,
            border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['ID', 'Normalized Word', 'Status', 'Rating'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left',
                      borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 50).map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 10px' }}>{e.sourceId || '—'}</td>
                    <td style={{ padding: '4px 10px' }}>{e.normWord || '—'}</td>
                    <td style={{ padding: '4px 10px', color: e.status === 'correct' ? 'var(--secondary)' : e.status === 'incorrect' ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {e.status || '—'}
                    </td>
                    <td style={{ padding: '4px 10px' }}>{e.rating || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length > 50 && (
              <p style={{ padding: '6px 10px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                … and {entries.length - 50} more
              </p>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleImport}
            disabled={importing || !targetChildId}>
            {importing ? 'Importing…' : `Import to ${targetChild?.name || 'selected child'}`}
          </button>
          {!targetChildId && (
            <p style={{ fontSize: '0.82rem', color: 'var(--danger)', marginTop: 8 }}>
              Please select a child above first.
            </p>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16,
          background: '#ffecec', color: 'var(--danger)', border: '1px solid var(--danger)',
          fontWeight: 600, fontSize: '0.88rem' }}>
          ⚠️ {error}
        </div>
      )}
      {result && (
        <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16,
          background: '#e3fff2', color: 'var(--secondary)', border: '1px solid var(--secondary)',
          fontWeight: 600, fontSize: '0.88rem' }}>
          {result}
        </div>
      )}
    </Layout>
  );
}
