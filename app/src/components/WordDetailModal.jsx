import { useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { wasEverMissed } from '../lib/normalize.js';

export default function WordDetailModal({ word, onClose, onPrev, onNext, position }) {
  const { history, initialHistory, ratings, recordHistory, recordRating } = useApp();
  const wordId     = word.wordId;
  const status     = history[wordId];
  const rating     = ratings[wordId] || 0;
  const everMissed = wasEverMissed(word, initialHistory);
  const audioRef   = useRef(null);

  // Stop audio and handle keyboard navigation on mount
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'ArrowLeft'  && onPrev) { e.preventDefault(); onPrev(); }
      if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext(); }
      if (e.key === 'Escape')                { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, [onPrev, onNext, onClose]);

  function audioFilename() {
    const pron = word.normalizedPronunciation;
    return pron
      ? `${word.normalizedWord}_${pron}.mp3`
      : `${word.normalizedWord}.mp3`;
  }

  function playAudio() {
    if (!word.normalizedWord) return;
    if (audioRef.current) audioRef.current.pause();
    audioRef.current = new Audio(`/audio/${audioFilename()}`);
    audioRef.current.play().catch(() => {});
  }

  async function markStatus(s) {
    await recordHistory(wordId, history[wordId] === s ? null : s);
  }

  async function setRating(r) {
    await recordRating(wordId, ratings[wordId] === r ? 0 : r);
  }

  const statusColor = status === 'correct'   ? 'var(--secondary)'
    :                 status === 'incorrect' ? 'var(--danger)'
    :                                          'var(--text-muted)';

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520, position: 'relative' }}>

        {position && (
          <p style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'0.82rem', marginBottom:8 }}>
            {position.current} / {position.total}
            <span style={{ marginLeft:10, fontSize:'0.75rem', color:'var(--text-muted)', opacity:0.6 }}>
              ← → to navigate · Esc to close
            </span>
          </p>
        )}

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={!onPrev}
            title="Previous word (←)">❮</button>
          <div style={{ textAlign:'center' }}>
            <h2 style={{ color: statusColor, fontSize:'1.8rem', marginBottom:4 }}>{word.word}</h2>
            {everMissed && status !== 'incorrect' && (
              <span className="badge badge-prior" style={{ fontSize:'0.75rem' }}>⚠ missed previously</span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={!onNext}
            title="Next word (→)">❯</button>
        </div>

        <div style={{ textAlign:'center', marginBottom:16 }}>
          <button className="btn btn-outline btn-sm" onClick={playAudio}>▶️ Play Audio</button>
        </div>

        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.9rem', marginBottom:20 }}>
          {[
            ['Pronunciation', word.pronunciation],
            ['Part of Speech', word.partOfSpeech],
            ['Definition',    word.definition],
            ['Origin',        word.origin],
            ['Sentence',      word.sentence],
          ].filter(([,v]) => v).map(([label, value]) => (
            <tr key={label} style={{ borderBottom:'1px solid var(--border)' }}>
              <td style={{ padding:'8px 10px 8px 0', fontWeight:600, color:'var(--text-muted)',
                whiteSpace:'nowrap', width:'36%' }}>{label}</td>
              <td style={{ padding:'8px 0' }}>{value}</td>
            </tr>
          ))}
        </table>

        <div style={{ marginBottom:16 }}>
          <p className="field-label" style={{ marginBottom:8 }}>Mark Status</p>
          <div style={{ display:'flex', gap:8 }}>
            {[['correct','✔ Correct','var(--secondary)'],['incorrect','✘ Incorrect','var(--danger)']].map(([s,label,color]) => (
              <button key={s} onClick={() => markStatus(s)} style={{
                flex:1, padding:'8px', borderRadius:8, fontWeight:600, fontSize:'0.88rem',
                border:`2px solid ${color}`, cursor:'pointer', fontFamily:'var(--font)',
                background: status === s ? color : 'transparent',
                color:      status === s ? '#fff' : color, transition:'all 0.15s'
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:20 }}>
          <p className="field-label" style={{ marginBottom:8 }}>Difficulty Rating</p>
          <div style={{ display:'flex', gap:6 }}>
            {[2,3,4,5].map(r => (
              <button key={r} onClick={() => setRating(r)} style={{
                flex:1, padding:'8px', borderRadius:8, fontWeight:700, fontSize:'0.88rem',
                border:`2px solid ${rating === r ? '#f0a500' : 'var(--border)'}`,
                background: rating === r ? '#fff9e6' : 'transparent',
                color:      rating === r ? '#f0a500' : 'var(--text-muted)',
                cursor:'pointer', fontFamily:'var(--font)', transition:'all 0.15s'
              }}>{r} ★</button>
            ))}
          </div>
        </div>

        <button className="btn btn-primary btn-full" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
