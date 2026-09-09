import { useState, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { wasEverMissed } from '../lib/normalize.js';
import WordDetailModal from '../components/WordDetailModal.jsx';
import Layout from '../components/Layout.jsx';

const BUNDLE_LABEL = b => b ? `Bundle ${b}` : 'Bundle';

// Generate and trigger a browser download of an xlsx file using ExcelJS
async function exportToExcel(wordList, history, ratings, childName) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Progress');

  const columns = [
    { header: 'Word ID',                   key: 'id',             width: 10 },
    { header: 'Word',                      key: 'word',           width: 20 },
    { header: 'normalized_word',           key: 'normalizedWord', width: 22 },
    { header: 'normalized_pronunciation',  key: 'normalizedPron', width: 26 },
    { header: 'Bundle',                    key: 'bundle',         width: 12 },
    { header: 'status',                    key: 'status',         width: 12 },
    { header: 'rating',                    key: 'rating',         width: 8  },
    { header: 'Definition',                key: 'definition',     width: 40 },
    { header: 'Part of Speech',            key: 'partOfSpeech',   width: 16 },
    { header: 'Pronunciation',             key: 'pronunciation',  width: 20 },
    { header: 'Origin',                    key: 'origin',         width: 30 },
    { header: 'Sentence',                  key: 'sentence',       width: 50 },
  ];
  ws.columns = columns;

  // Bold header row
  ws.getRow(1).font = { bold: true };

  wordList.forEach(w => {
    ws.addRow({
      id:             w.id                    || '',
      word:           w.word,
      normalizedWord: w.normalizedWord        || '',
      normalizedPron: w.normalizedPronunciation || '',
      bundle:         w.bundle                || '',
      status:         history[w.wordId]       || 'untested',
      rating:         ratings[w.wordId]       || '',
      definition:     w.definition            || '',
      partOfSpeech:   w.partOfSpeech          || '',
      pronunciation:  w.pronunciation         || '',
      origin:         w.origin                || '',
      sentence:       w.sentence              || '',
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `progress_${childName}_${new Date().toISOString().slice(0,10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}


/* ── Memoized word card ───────────────────────────────────────────
   Only re-renders when THIS word's status, rating, or missed flag
   changes — not on every filter/sort of the full list.            */
const WordCard = memo(function WordCard({ w, status, rating, missed, onClick }) {
  return (
    <div
      key={w.wordId}
      className={`word-card ${status || 'untested'}`}
      onClick={onClick}
    >
      <div>{w.word}</div>
      <div className="word-card-badges">
        {rating > 0 && <span className="badge badge-star">{rating}★</span>}
        {missed && status !== 'incorrect' && (
          <span className="badge badge-prior" style={{ fontSize:'0.7rem' }}>⚠ prior</span>
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.status === next.status &&
  prev.rating === next.rating &&
  prev.missed === next.missed &&
  prev.w.wordId === next.w.wordId
);

export default function Review() {
  const { wordList, history, initialHistory, ratings, activeChild } = useApp();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('all');
  const [bundleFilter, setBundleFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState(0);
  const [sortType,     setSortType]     = useState('alpha');
  // Stable random order captured on shuffle click — not recalculated on every filter change
  const [randomOrder,  setRandomOrder]  = useState(null);
  const [detailIdx,    setDetailIdx]    = useState(null);
  const [isExporting,  setIsExporting]  = useState(false);

  const bundles = useMemo(() => (
    [...new Set(wordList.map(w => w.bundle).filter(Boolean))].sort()
  ), [wordList]);

  const missedWordIds = useMemo(() => {
    const set = new Set();
    wordList.forEach(w => {
      if (wasEverMissed(w, initialHistory)) set.add(w.wordId);
    });
    return set;
  }, [initialHistory, wordList]);

  const filtered = useMemo(() => {
    let list = wordList.filter(w => {
      const status = history[w.wordId];
      const rating = ratings[w.wordId] || 0;
      if (statusFilter === 'correct'   && status !== 'correct')   return false;
      if (statusFilter === 'incorrect' && status !== 'incorrect') return false;
      if (statusFilter === 'untested'  && (status === 'correct' || status === 'incorrect')) return false;
      if (bundleFilter !== 'all' && w.bundle !== bundleFilter) return false;
      if (ratingFilter > 0 && rating !== ratingFilter) return false;
      return true;
    });

    if (sortType === 'alpha') {
      list = [...list].sort((a, b) => {
        const ai = a.id !== undefined ? String(a.id) : '';
        const bi = b.id !== undefined ? String(b.id) : '';
        if (ai && bi) return ai.localeCompare(bi, undefined, { numeric: true });
        if (ai) return -1; if (bi) return 1;
        return a.word.localeCompare(b.word);
      });
    } else if (sortType === 'random' && randomOrder) {
      // Apply the stable random order captured when shuffle was clicked
      const orderMap = {};
      randomOrder.forEach((id, i) => { orderMap[id] = i; });
      list = [...list].sort((a, b) => (orderMap[a.wordId] ?? 9999) - (orderMap[b.wordId] ?? 9999));
    }
    return list;
  }, [wordList, history, ratings, statusFilter, bundleFilter, ratingFilter, sortType, randomOrder]);

  function handleShuffle() {
    // Capture a new random order and switch to random sort
    const shuffled = [...wordList].map(w => w.wordId).sort(() => Math.random() - 0.5);
    setRandomOrder(shuffled);
    setSortType('random');
  }

  function launchPractice() {
    // Store a minimal filter descriptor in sessionStorage instead of the full word list
    sessionStorage.setItem('practiceFilter', JSON.stringify({
      wordIds: filtered.map(w => w.wordId)
    }));
    navigate('/practice');
  }

  const totals = useMemo(() => {
    const correct   = wordList.filter(w => history[w.wordId] === 'correct').length;
    const incorrect = wordList.filter(w => history[w.wordId] === 'incorrect').length;
    return { correct, incorrect, untested: wordList.length - correct - incorrect };
  }, [wordList, history]);

  if (!activeChild) {
    return <Layout><div className="empty-state"><div className="icon">👧</div>
      <h3>No child selected</h3><p>Select a child from the nav bar.</p></div></Layout>;
  }

  return (
    <Layout>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ marginBottom:4 }}>Word Review</h1>
          <p>{activeChild.avatar} {activeChild.name} — {wordList.length} words</p>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="btn btn-secondary btn-sm"
            disabled={isExporting}
            onClick={async () => {
              setIsExporting(true);
              try { await exportToExcel(wordList, history, ratings, activeChild.name); }
              finally { setIsExporting(false); }
            }}>
            {isExporting ? '⏳ Exporting…' : '⬇️ Export Excel'}
          </button>
          <button className="btn btn-primary" onClick={launchPractice} disabled={filtered.length === 0}>
            ✏️ Practice{filtered.length !== wordList.length ? ` (${filtered.length})` : ''}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {[
          { label:'Correct',   count:totals.correct,   color:'var(--secondary)' },
          { label:'Incorrect', count:totals.incorrect, color:'var(--danger)' },
          { label:'Untested',  count:totals.untested,  color:'var(--text-muted)' }
        ].map(s => (
          <div key={s.label} className="card" style={{ flex:'1 1 120px', padding:'14px 16px', textAlign:'center' }}>
            <div style={{ fontSize:'1.5rem', fontWeight:700, color:s.color }}>{s.count}</div>
            <div style={{ fontSize:'0.82rem', color:'var(--text-muted)', fontWeight:600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
        {['all','correct','incorrect','untested'].map(f => (
          <button key={f} className={`filter-btn ${statusFilter === f ? 'active' : ''}`}
            onClick={() => setStatusFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}

        {bundles.length > 0 && (
          <select value={bundleFilter} onChange={e => setBundleFilter(e.target.value)}
            style={{ padding:'6px 10px', borderRadius:50, border:'2px solid var(--border)',
              fontFamily:'var(--font)', fontWeight:600, fontSize:'0.82rem',
              background: bundleFilter !== 'all' ? 'var(--primary)' : 'var(--surface)',
              color:      bundleFilter !== 'all' ? '#fff' : 'var(--text-muted)', cursor:'pointer' }}>
            <option value="all">All Bundles</option>
            {bundles.map(b => <option key={b} value={b}>{BUNDLE_LABEL(b)}</option>)}
          </select>
        )}

        <select value={ratingFilter} onChange={e => setRatingFilter(Number(e.target.value))}
          style={{ padding:'6px 10px', borderRadius:50, border:'2px solid var(--border)',
            fontFamily:'var(--font)', fontWeight:600, fontSize:'0.82rem',
            background: ratingFilter > 0 ? 'var(--primary)' : 'var(--surface)',
            color:      ratingFilter > 0 ? '#fff' : 'var(--text-muted)', cursor:'pointer' }}>
          <option value={0}>Any Rating</option>
          {[2,3,4,5].map(r => <option key={r} value={r}>{r} ★</option>)}
        </select>

        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          <button className={`filter-btn ${sortType === 'alpha' ? 'active' : ''}`}
            onClick={() => setSortType('alpha')}>A–Z</button>
          <button className={`filter-btn ${sortType === 'random' ? 'active' : ''}`}
            onClick={handleShuffle}>🔀 Shuffle</button>
        </div>
      </div>

      {/* Word grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🔍</div>
          <h3>No words match this filter</h3>
        </div>
      ) : (
        <div className="word-grid">
          {filtered.map((w, i) => (
            <WordCard
              key={w.wordId}
              w={w}
              status={history[w.wordId]}
              rating={ratings[w.wordId] || 0}
              missed={missedWordIds.has(w.wordId)}
              onClick={() => setDetailIdx(i)}
            />
          ))}
        </div>
      )}

      {detailIdx !== null && (
        <WordDetailModal
          word={filtered[detailIdx]}
          position={{ current: detailIdx + 1, total: filtered.length }}
          onClose={() => setDetailIdx(null)}
          onPrev={detailIdx > 0         ? () => setDetailIdx(i => i - 1) : null}
          onNext={detailIdx < filtered.length - 1 ? () => setDetailIdx(i => i + 1) : null}
        />
      )}
    </Layout>
  );
}
