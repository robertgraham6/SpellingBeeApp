import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import Layout from '../components/Layout.jsx';
import { playWordAudio, stopCurrentAudio } from '../lib/audio.js';

/* ── Audio helper — reuses one Audio instance per session ─────── */
let _audioTimer = null;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function playAudio(word, btnRef, immediate = false) {
  if (!word) return;
  if (_audioTimer) { clearTimeout(_audioTimer); _audioTimer = null; }
  stopCurrentAudio();
  if (btnRef?.current) btnRef.current.disabled = true;

  const fire = () => {
    playWordAudio(word, {
      btnRef,
      onStart: () => { if (btnRef?.current) btnRef.current.disabled = true; },
      onEnd:   () => { if (btnRef?.current) btnRef.current.disabled = false; },
      onError: () => { if (btnRef?.current) btnRef.current.disabled = false; },
    });
  };

  if (immediate) { fire(); }
  else { _audioTimer = setTimeout(() => { _audioTimer = null; fire(); }, 1000); }
}

/* ── Misspelling generator for MC distractors ─────────────────── */
/* ── Progress bar ─────────────────────────────────────────────── */
function ProgressBar({ current, total, streak }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const streakColor = streak >= 10 ? '#f0a500' : streak >= 5 ? '#00cec9' : streak >= 3 ? 'var(--warning)' : 'var(--primary)';
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:'0.85rem', fontWeight:600 }}>
        <span style={{ color:'var(--text-muted)' }}>Word {current} of {total}</span>
        {streak > 1 && <span style={{ color:streakColor }}>🔥 {streak} streak</span>}
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width:`${pct}%`, background:streakColor }} />
      </div>
    </div>
  );
}

/* ── Rating buttons ───────────────────────────────────────────── */
function RatingButtons({ wordId, ratings, onRate }) {
  return (
    <div style={{ display:'flex', gap:6, justifyContent:'center' }}>
      {[2,3,4,5].map(r => (
        <button key={r} onClick={() => onRate(wordId, ratings[wordId] === r ? 0 : r)} style={{
          padding:'6px 12px', borderRadius:8, fontWeight:700, fontSize:'0.82rem',
          border:`2px solid ${ratings[wordId] === r ? '#f0a500' : 'var(--border)'}`,
          background: ratings[wordId] === r ? '#fff9e6' : 'transparent',
          color:      ratings[wordId] === r ? '#f0a500' : 'var(--text-muted)',
          cursor:'pointer', fontFamily:'var(--font)', transition:'all 0.15s'
        }}>{r}★</button>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SPELLING BEE MODE
   Keeps letter-diff UI feedback showing correct/incorrect letters.
════════════════════════════════════════════════════════════════ */
function SpellingBee({ word, onResult, ratings, onRate, wordIndex, totalWords, streak }) {
  const [input,    setInput]    = useState('');
  const [result,   setResult]   = useState(null); // null | 'correct' | 'incorrect'
  const [feedback, setFeedback] = useState([]);   // [{ letter, ok }] — per-letter diff
  const inputRef   = useRef();
  const playBtnRef = useRef();
  const wordId = word.wordId;

  useEffect(() => {
    setInput(''); setResult(null); setFeedback([]);
    setTimeout(() => {
      playAudio(word, playBtnRef);
      inputRef.current?.focus();
    }, 200);
  }, [word]);

  function submit() {
    const val    = input.trim().toLowerCase();
    if (!val) return;
    const target = word.word.trim().toLowerCase();
    const valid  = [target, ...(word.allowableSpellings || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)];
    const correct = valid.includes(val);

    // Build per-letter diff for visual feedback (kept per user request)
    const diff = [];
    for (let i = 0; i < Math.max(val.length, target.length); i++) {
      diff.push({ letter: (val[i] || '_').toUpperCase(), ok: val[i] === target[i] });
    }
    setFeedback(diff);
    setResult(correct ? 'correct' : 'incorrect');
    onResult(word, correct ? 'correct' : 'incorrect');
  }

  return (
    <div>
      <ProgressBar current={wordIndex + 1} total={totalWords} streak={streak} />
      <div style={{ marginBottom:16 }}>
        <p style={{ textAlign:'center', fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:6 }}>
          Rate Difficulty
        </p>
        <RatingButtons wordId={wordId} ratings={ratings} onRate={onRate} />
      </div>

      <div style={{ textAlign:'center', marginBottom:24 }}>
        <button ref={playBtnRef} className="btn btn-outline btn-lg"
          onClick={() => playAudio(word, playBtnRef, true)}>
          ▶️ Play Word
        </button>
        {word.pronunciation && (
          <p style={{ marginTop:8, color:'var(--text-muted)', fontSize:'0.88rem' }}>
            {word.pronunciation}
          </p>
        )}
      </div>

      {result === null && (
        <div style={{ textAlign:'center', marginBottom:20 }}>
          <input ref={inputRef} className="input"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Type the word…"
            style={{ maxWidth:320, textAlign:'center', fontSize:'1.1rem', letterSpacing:2 }}
            autoComplete="off" autoCorrect="off" spellCheck={false} />
          <div style={{ marginTop:12 }}>
            <button className="btn btn-primary" onClick={submit} disabled={!input.trim()}>
              Submit
            </button>
          </div>
        </div>
      )}

      {result !== null && (
        <div style={{ textAlign:'center' }}>
          {/* Per-letter diff UI — kept intentionally */}
          <div style={{ fontSize:'1.1rem', marginBottom:12, letterSpacing:4 }}>
            {feedback.map((f, i) => (
              <span key={i} style={{ color: f.ok ? 'var(--secondary)' : 'var(--danger)', fontWeight:700 }}>
                {f.letter}
              </span>
            ))}
          </div>
          {result === 'incorrect' && (
            <p style={{ color:'var(--text-muted)', marginBottom:12 }}>
              Correct spelling: <strong style={{ color:'var(--text)' }}>{word.word}</strong>
            </p>
          )}
          {result === 'correct' && (
            <p style={{ color:'var(--secondary)', fontWeight:700, marginBottom:12 }}>Correct! 🎉</p>
          )}
          <button className="btn btn-primary" onClick={() => onResult(word, null, true)}>
            Next Word →
          </button>
        </div>
      )}

      {word.definition && (
        <p style={{ marginTop:24, color:'var(--text-muted)', fontSize:'0.88rem', textAlign:'center' }}>
          <em>{word.definition}</em>
        </p>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   FLASHCARD MODE
════════════════════════════════════════════════════════════════ */
function Flashcard({ word, onResult, ratings, onRate, wordIndex, totalWords, streak }) {
  const [revealed, setRevealed] = useState(false);
  const playBtnRef = useRef();
  const wordId = word.wordId;

  useEffect(() => {
    setRevealed(false);
    setTimeout(() => playAudio(word, playBtnRef), 200);
  }, [word]);

  return (
    <div>
      <ProgressBar current={wordIndex + 1} total={totalWords} streak={streak} />
      <RatingButtons wordId={wordId} ratings={ratings} onRate={onRate} />

      <div className="card" style={{ marginTop:20, textAlign:'center' }}>
        {word.pronunciation && (
          <p style={{ color:'var(--text-muted)', fontSize:'0.9rem', marginBottom:8 }}>{word.pronunciation}</p>
        )}
        <p style={{ fontSize:'1rem', marginBottom:12 }}>{word.definition || 'No definition.'}</p>
        {word.partOfSpeech && <span className="badge badge-untested">{word.partOfSpeech}</span>}
        {word.origin && (
          <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginTop:8 }}>Origin: {word.origin}</p>
        )}
        {word.sentence && (
          <p style={{ fontSize:'0.85rem', fontStyle:'italic', color:'var(--text-muted)', marginTop:8 }}>
            "{word.sentence.replace(new RegExp(escapeRegex(word.word), 'gi'), '___')}"
          </p>
        )}
        <div style={{ marginTop:20 }}>
          <button ref={playBtnRef} className="btn btn-outline btn-sm" style={{ marginBottom:12 }}
            onClick={() => playAudio(word, playBtnRef, true)}>▶️ Audio</button>
        </div>
        {!revealed ? (
          <button className="btn btn-primary btn-full" onClick={() => setRevealed(true)}>
            Reveal Word
          </button>
        ) : (
          <div>
            <h2 style={{ fontSize:'2rem', margin:'16px 0', color:'var(--primary)' }}>{word.word}</h2>
            <div style={{ display:'flex', gap:12, justifyContent:'center' }}>
              <button className="btn btn-danger"    onClick={() => onResult(word, 'incorrect', true)}>✘ Missed it</button>
              <button className="btn btn-secondary" onClick={() => onResult(word, 'correct',   true)}>✔ Got it</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MULTIPLE CHOICE MODE
════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   PRACTICE PAGE
════════════════════════════════════════════════════════════════ */
const MODES = [
  { id:'spelling',  label:'Spelling Bee', emoji:'🐝', desc:'Type the word from audio — just like the real thing.' },
  { id:'flashcard', label:'Flashcards',   emoji:'🃏', desc:'See the definition, then reveal the word.' },
];

export default function Practice() {
  const { wordList, history, ratings, recordHistoryLocal, recordRating,
          activeChild, selectChild, childList, childLoading,
          saveSettings, flushHistoryBatch, profile } = useApp();
  const navigate = useNavigate();
  // Accumulate history writes during session; flush in one batch at session end
  const pendingWritesRef = useRef({});
  const flushPendingRef   = useRef(null);

  // Resolve the practice word list from the filter descriptor stored by Review,
  // or fall back to the full word list from context.
  // Uses wordList from context so it always has the up-to-date data even if
  // the user navigated here directly (not via Review).
  useEffect(() => {
    return () => {
      flushPendingRef.current?.();
      if (_audioTimer) { clearTimeout(_audioTimer); _audioTimer = null; }
      stopCurrentAudio();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [practiceList] = useState(() => {
    try {
      const stored = sessionStorage.getItem('practiceFilter');
      if (stored) {
        sessionStorage.removeItem('practiceFilter');
        const { wordIds } = JSON.parse(stored);
        if (Array.isArray(wordIds) && wordIds.length > 0) {
          // wordList may still be loading — this will be [] if navigated directly
          // The useEffect below handles the direct-navigation case
          const set = new Set(wordIds);
          const filtered = wordList.filter(w => set.has(w.wordId));
          if (filtered.length > 0) return filtered;
        }
      }
    } catch {}
    return wordList; // full list fallback
  });

  // If practiceList is empty (direct navigation before context loaded),
  // we show a loading/empty state — the component re-renders when wordList populates
  const resolvedList = practiceList.length > 0 ? practiceList : wordList;

  // For parents: show child picker before the mode selector.
  // Auto-confirmed if: not a parent, or only one child (no ambiguity).
  const [childConfirmed, setChildConfirmed] = useState(profile?.role !== 'parent' || childList.length <= 1);
  const [mode,      setMode]      = useState(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [streak,    setStreak]    = useState(0);
  const [completed, setCompleted] = useState(false);
  // Snapshot of history at session start — used for session-only score at end
  const [sessionStartHistory] = useState(() => ({ ...history }));

  const currentWord = resolvedList[wordIndex];

  function flushPending() {
    const writes = Object.values(pendingWritesRef.current);
    if (!writes.length) return;
    flushHistoryBatch(writes);
    pendingWritesRef.current = {};
  }
  // Keep the ref current on every render so the cleanup useEffect always
  // calls the latest closure — assigned in an effect to avoid mutating a
  // ref during the render phase (which misfires in React StrictMode).
  useEffect(() => { flushPendingRef.current = flushPending; });

  function handleResult(word, status, advance = false) {
    if (status !== null) {
      // Queue into pending batch — flush once at session end, not on every word
      pendingWritesRef.current[word.wordId] = { wordId: word.wordId, status };
      // Update in-memory state immediately so UI stays responsive.
      // recordHistoryLocal skips the per-word DB write — the batch
      // flush at session end via flushHistoryBatch covers persistence.
      recordHistoryLocal(word.wordId, status);
      setStreak(s => status === 'correct' ? s + 1 : 0);
    }
    if (advance) {
      if (wordIndex < resolvedList.length - 1) setWordIndex(i => i + 1);
      else setCompleted(true);
    }
  }

  async function flushAndNavigate(dest) {
    const writes = Object.values(pendingWritesRef.current);
    pendingWritesRef.current = {};
    if (writes.length) await flushHistoryBatch(writes);
    navigate(dest);
  }

  function handleRate(wordId, rating) { recordRating(wordId, rating); }

  function restart() { setWordIndex(0); setStreak(0); setCompleted(false); }

  if (!activeChild) {
    return <Layout><div className="empty-state"><div className="icon">👧</div>
      <h3>No child selected</h3><p>Select a child from the nav bar.</p></div></Layout>;
  }

  if (resolvedList.length === 0) {
    return <Layout><div className="empty-state"><div className="icon">📚</div>
      <h3>No words to practice</h3>
      <p style={{ marginBottom:20 }}>Import a word list first, or adjust your review filters.</p>
      <button className="btn btn-primary" onClick={() => navigate('/word-lists')}>Import Words</button>
    </div></Layout>;
  }

  // ── Who's playing? — shown to parents before mode selector ──────
  if (!childConfirmed) {
    return (
      <Layout>
        <div style={{ maxWidth:480, margin:'0 auto' }}>
          <h1 style={{ textAlign:'center', marginBottom:8 }}>Who's playing?</h1>
          <p style={{ textAlign:'center', marginBottom:32, color:'var(--text-muted)' }}>
            Select a child to start practice.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {childList.map(child => (
              <div
                key={child.id}
                className="card card-clickable"
                onClick={async () => {
                  await selectChild(child);
                  // Clear any filter from Review — it was for the previous child
                  sessionStorage.removeItem('practiceFilter');
                  pendingWritesRef.current = {};
                  setChildConfirmed(true);
                }}
                style={{
                  display:'flex', alignItems:'center', gap:16, padding:'18px 22px',
                  border: activeChild?.id === child.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                  opacity: childLoading ? 0.6 : 1, pointerEvents: childLoading ? 'none' : 'auto'
                }}
              >
                <div style={{ fontSize:'2.4rem', flexShrink:0 }}>{child.avatar}</div>
                <div>
                  <h3 style={{ marginBottom:2 }}>{child.name}</h3>
                  <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>
                    {child.access_type === 'email' ? child.email : 'Local account'}
                  </p>
                </div>
                {activeChild?.id === child.id && (
                  <span style={{
                    marginLeft:'auto', background:'var(--primary)', color:'#fff',
                    borderRadius:50, padding:'2px 10px', fontSize:'0.78rem', fontWeight:600
                  }}>Active</span>
                )}
              </div>
            ))}
          </div>
          {childLoading && (
            <p style={{ textAlign:'center', marginTop:16, color:'var(--text-muted)', fontSize:'0.88rem' }}>
              Loading…
            </p>
          )}
        </div>
      </Layout>
    );
  }

  // ── Mode selector ──────────────────────────────────────────────
  if (!mode) {
    return (
      <Layout>
        <div style={{ maxWidth:480, margin:'0 auto' }}>
          <h1 style={{ textAlign:'center', marginBottom:8 }}>Practice</h1>
          <p style={{ textAlign:'center', marginBottom:8 }}>
            {activeChild.avatar} {activeChild.name}
          </p>
          <p style={{ textAlign:'center', marginBottom:32, color:'var(--text-muted)' }}>
            {resolvedList.length} word{resolvedList.length !== 1 ? 's' : ''} selected
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {MODES.map(m => (
              <div key={m.id} className="card card-clickable" onClick={() => {
                setMode(m.id);
                // Persist last-used mode so it's restored on next login
                if (activeChild?.id && profile?.id) {
                  saveSettings(activeChild.id, m.id, activeChild.theme || 'space');
                }
              }}
                style={{ display:'flex', alignItems:'center', gap:16, padding:'20px 22px' }}>
                <div style={{ fontSize:'2.4rem', flexShrink:0 }}>{m.emoji}</div>
                <div>
                  <h3 style={{ marginBottom:4 }}>{m.label}</h3>
                  <p style={{ fontSize:'0.88rem' }}>{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  // ── Session complete ───────────────────────────────────────────
  if (completed) {
    // Score shows only words changed THIS session (not all-time totals)
    const sessionCorrect = resolvedList.filter(w => {
      const before = sessionStartHistory[w.wordId];
      return history[w.wordId] === 'correct' && before !== 'correct';
    }).length;
    const sessionIncorrect = resolvedList.filter(w => {
      const before = sessionStartHistory[w.wordId];
      return history[w.wordId] === 'incorrect' && before !== 'incorrect';
    }).length;

    return (
      <Layout>
        <div style={{ maxWidth:420, margin:'0 auto', textAlign:'center' }}>
          <div style={{ fontSize:'4rem', marginBottom:12 }}>🎉</div>
          <h1 style={{ marginBottom:16 }}>Session Complete!</h1>
          <div style={{ display:'flex', gap:12, justifyContent:'center', marginBottom:28 }}>
            <div className="card" style={{ flex:1, padding:'16px', textAlign:'center' }}>
              <div style={{ fontSize:'1.8rem', fontWeight:700, color:'var(--secondary)' }}>{sessionCorrect}</div>
              <div style={{ fontSize:'0.82rem', color:'var(--text-muted)', fontWeight:600 }}>Correct This Session</div>
            </div>
            <div className="card" style={{ flex:1, padding:'16px', textAlign:'center' }}>
              <div style={{ fontSize:'1.8rem', fontWeight:700, color:'var(--danger)' }}>{sessionIncorrect}</div>
              <div style={{ fontSize:'0.82rem', color:'var(--text-muted)', fontWeight:600 }}>Incorrect This Session</div>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <button className="btn btn-primary btn-full" onClick={() => {
                const writes = Object.values(pendingWritesRef.current);
                pendingWritesRef.current = {};
                if (writes.length) flushHistoryBatch(writes);
                restart();
              }}>Practice Again</button>
            <button className="btn btn-outline btn-full" onClick={() => {
                const writes = Object.values(pendingWritesRef.current);
                pendingWritesRef.current = {};
                if (writes.length) flushHistoryBatch(writes);
                setMode(null);
              }}>Change Mode</button>
            <button className="btn btn-ghost btn-full" onClick={() => flushAndNavigate('/review')}>Back to Review</button>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Active session ─────────────────────────────────────────────
  const modeLabel   = MODES.find(m => m.id === mode)?.label || '';
  const sharedProps = {
    word: currentWord, wordIndex, totalWords: resolvedList.length,
    ratings, onRate: handleRate, onResult: handleResult, streak
  };

  return (
    <Layout>
      <div style={{ maxWidth:540, margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h2 style={{ marginBottom:2 }}>{modeLabel}</h2>
            <p style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>
              {activeChild.avatar} {activeChild.name}
            </p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Change Mode</button>
            <button className="btn btn-ghost btn-sm" onClick={() => flushAndNavigate('/review')}>← Review</button>
          </div>
        </div>

        {mode === 'spelling'  && <SpellingBee {...sharedProps} />}
        {mode === 'flashcard' && <Flashcard   {...sharedProps} />}
      </div>
    </Layout>
  );
}
