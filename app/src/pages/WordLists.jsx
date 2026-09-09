import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { DB } from '../lib/db.js';
import { applyNormalization } from '../lib/normalize.js';
import Layout from '../components/Layout.jsx';
import AddWordsModal from '../components/AddWordsModal.jsx';
import WordEditModal from '../components/WordEditModal.jsx';
import ImportDiffModal from '../components/ImportDiffModal.jsx';
import AdminOverview from '../components/AdminOverview.jsx';

// ── Confirmation modal ──────────────────────────────────────────────────────────
// Identical to the one in Home.jsx — inline here to keep components self-contained.
function ConfirmModal({ title, message, confirmLabel, variant = 'danger', onConfirm, onCancel }) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const confirmStyle = {
    danger:  { background: 'var(--danger)',  color: '#fff', border: '2px solid var(--danger)'  },
    warning: { background: 'var(--warning)', color: '#fff', border: '2px solid var(--warning)' },
  }[variant];

  async function handleConfirm() {
    setBusy(true); setError('');
    try { await onConfirm(); }
    catch (e) { setError(e.message || 'Something went wrong.'); setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-title" style={{
          color: variant === 'danger' ? 'var(--danger)' : 'var(--warning)'
        }}>{title}</div>
        <p style={{ textAlign:'center', marginBottom:20 }}>{message}</p>
        {error && (
          <p style={{ color:'var(--danger)', fontSize:'0.88rem',
            marginBottom:16, textAlign:'center' }}>{error}</p>
        )}
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-full" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-full" style={confirmStyle}
            onClick={handleConfirm} disabled={busy}>{busy ? '…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── CSV / DSV parser ──────────────────────────────────────────────────────────
function parseDSV(text, delimiter) {
  const rows = []; let cur = []; let val = ''; let inQ = false;
  text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c==='"') { if(inQ && text[i+1]==='"'){val+='"';i++;}else inQ=!inQ; }
    else if (c===delimiter&&!inQ){ cur.push(val.trim()); val=''; }
    else if (c==='\n'&&!inQ){ cur.push(val.trim()); if(cur.some(Boolean)) rows.push(cur); cur=[]; val=''; }
    else val+=c;
  }
  if(val||cur.length){ cur.push(val.trim()); rows.push(cur); }
  return rows;
}

function parseToWords(data) {
  if (!data || data.length < 2) return null;
  const header = data[0].map(h => String(h).toLowerCase().trim());
  const get = (...candidates) => header.findIndex(h => candidates.some(c => h.includes(c)));
  const idx = {
    word:   get('word','words'),
    bundle: get('bundle','bee','category','list'),
    def:    get('definition','def','meaning'),
    pron:   get('pronunciation','pronunciations','ipa'),
    alt:    get('allowablespellings','allowable'),
    origin: get('origin','etymology'),
    pos:    get('part_of_speech','partofspeech','pos'),
    audio:  get('audio_link','audiolink','audio','sound'),
    sent:   get('sentence','example'),
    id:     get('id','number','no','rank','order'),
    // Progress import columns
    normWord: get('normalized_word','normalizedword','norm_word'),
    normPron: get('normalized_pronunciation','normalizedpronunciation','norm_pron'),
    status:   get('status','result','progress'),
    rating:   get('rating','difficulty','stars'),
  };
  if (idx.word === -1) return null;
  const col = (row, i) => i > -1 ? String(row[i] || '') : '';
  const validStatuses = new Set(['correct','incorrect','untested']);
  return data.slice(1)
    .filter(row => row && row[idx.word] && String(row[idx.word]).trim())
    .map(row => ({
      word:               String(row[idx.word]).trim(),
      bundle:             col(row, idx.bundle),
      definition:         col(row, idx.def),
      pronunciation:      col(row, idx.pron),
      allowableSpellings: col(row, idx.alt),
      origin:             col(row, idx.origin),
      partOfSpeech:       col(row, idx.pos),
      audioLink:          col(row, idx.audio),
      sentence:           col(row, idx.sent),
      id:                 idx.id > -1 ? row[idx.id] : undefined,
      // Progress fields — only included when present in the file
      normalizedWord: col(row, idx.normWord) || undefined,
      normalizedPron: col(row, idx.normPron) || undefined,
      importStatus:   validStatuses.has(col(row, idx.status).toLowerCase())
                        ? col(row, idx.status).toLowerCase() : undefined,
      importRating:   col(row, idx.rating) ? Number(col(row, idx.rating)) || undefined : undefined,
    }));
}

// ── Shared: import preview panel ──────────────────────────────────────────────
function ImportPreview({ preview, listName, setListName, onConfirm, onCancel, importing, notice }) {
  const hasProgress = preview.words.some(w => w.importStatus || w.importRating);
  return (
    <div className="card" style={{ marginBottom:24 }}>
      <h3 style={{ marginBottom:12 }}>Preview — {preview.words.length} words found</h3>

      {preview.collisions.length > 0 && (
        <div style={{ background:'#fff3cd', border:'1px solid #ffc107', color:'#856404',
          padding:'10px 14px', borderRadius:8, fontSize:'0.85rem', marginBottom:14 }}>
          ⚠️ {preview.collisions.length} collision(s) auto-suffixed:{' '}
          {preview.collisions.map(c => `"${c.word}" → ${c.assigned}`).join(', ')}
        </div>
      )}

      {hasProgress && (
        <div style={{ background:'#e3fff2', border:'1px solid var(--secondary)', color:'#006f5a',
          padding:'10px 14px', borderRadius:8, fontSize:'0.85rem', marginBottom:14 }}>
          ✅ Progress data detected — status/rating will be imported along with the word list.
        </div>
      )}

      {notice && (
        <div style={{ background:'#fff3e0', border:'1px solid #ff9800', color:'#7a4500',
          padding:'10px 14px', borderRadius:8, fontSize:'0.85rem', marginBottom:14 }}>
          {notice}
        </div>
      )}

      <div style={{ marginBottom:14 }}>
        <label className="field-label">List Name</label>
        <input className="input" value={listName} onChange={e => setListName(e.target.value)} />
      </div>

      <div style={{ overflowX:'auto', marginBottom:16 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.88rem' }}>
          <thead>
            <tr style={{ background:'#f0f0fa', textAlign:'left' }}>
              {['Word','Normalized','Definition','Sentence'].map(h => (
                <th key={h} style={{ padding:'8px 10px', border:'1px solid var(--border)',
                  fontWeight:600, color: h === 'Normalized' ? 'var(--primary)' : 'var(--text)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.words.slice(0, 8).map((w, i) => (
              <tr key={i}>
                <td style={{ padding:'8px 10px', border:'1px solid var(--border)' }}>{w.word}</td>
                <td style={{ padding:'8px 10px', border:'1px solid var(--border)',
                  fontFamily:'monospace', fontSize:'0.82em', color:'var(--primary)' }}>
                  {w.normalizedWord}
                </td>
                <td style={{ padding:'8px 10px', border:'1px solid var(--border)', color:'var(--text-muted)' }}>
                  {w.definition?.substring(0,50)}{w.definition?.length > 50 ? '…' : ''}
                </td>
                <td style={{ padding:'8px 10px', border:'1px solid var(--border)', color:'var(--text-muted)' }}>
                  {w.sentence?.substring(0,50)}{w.sentence?.length > 50 ? '…' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.words.length > 8 && (
          <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginTop:6 }}>
            …and {preview.words.length - 8} more words
          </p>
        )}
      </div>

      <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={importing || !listName.trim()}>
          {importing ? 'Importing…' : `Confirm Import (${preview.words.length} words)`}
        </button>
      </div>
    </div>
  );
}

// ── Shared: list row with rename / delete ─────────────────────────────────────
function ListRow({ list, onRename, onDelete, deletingId, extra }) {
  const [renaming,     setRenaming]     = useState(false);
  const [renameValue,  setRenameValue]  = useState('');

  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0',
      borderBottom:'1px solid var(--border)',
      opacity: deletingId === list.id ? 0.4 : 1, transition:'opacity 0.2s' }}>
      {renaming ? (
        <>
          <input className="input" value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { onRename(list, renameValue); setRenaming(false); }
              if (e.key === 'Escape') setRenaming(false);
            }}
            autoFocus style={{ flex:1, padding:'6px 10px' }} />
          <button className="btn btn-primary btn-sm"
            onClick={() => { onRename(list, renameValue); setRenaming(false); }}>Save</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(false)}>Cancel</button>
        </>
      ) : (
        <>
          <div style={{ flex:1 }}>
            <p style={{ fontWeight:600, margin:0 }}>{list.name}</p>
            <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', margin:0 }}>
              {list.wordCount ?? '?'} words · {new Date(list.createdAt).toLocaleDateString()}
            </p>
          </div>
          {extra}
          <button className="btn btn-ghost btn-sm"
            onClick={() => { setRenaming(true); setRenameValue(list.name); }}
            disabled={deletingId === list.id} title="Rename">✏️</button>
          <button className="btn btn-ghost btn-sm"
            onClick={() => onDelete(list)}
            disabled={deletingId === list.id}
            style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>
            {deletingId === list.id ? '…' : '🗑️'}
          </button>
        </>
      )}
    </div>
  );
}

// ── File-picker hook shared by all import sections ────────────────────────────
function useFilePicker(onParsed, onError) {
  const fileRef = useRef();

  function handleFile(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const process = (data) => {
      const words = parseToWords(data);
      if (!words || words.length === 0) {
        onError?.('No valid words found. Check that your file has a "word" column.');
        return;
      }
      const collisions = applyNormalization(words);
      onParsed({ words, collisions });
    };
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = async e => {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(e.target.result);
        const ws = wb.worksheets[0];
        const rows = [];
        ws.eachRow(row => rows.push(row.values.slice(1))); // slice off index-0 null
        process(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const text  = e.target.result;
        const delim = text.split('\n')[0].includes('|') ? '|' : ',';
        process(parseDSV(text, delim));
      };
      reader.readAsText(file);
    }
  }

  return { fileRef, handleFile };
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN VIEW
// ══════════════════════════════════════════════════════════════════════════════
function AdminWordLists({ profile }) {
  const showToast = useToast();
  const { refreshWordListIfOnList } = useApp();
  const [adminLists,   setAdminLists]   = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [preview,      setPreview]      = useState(null);
  const [listName,     setListName]     = useState('');
  const [importing,    setImporting]    = useState(false);
  const [importMsg,    setImportMsg]    = useState('');
  const [deletingId,   setDeletingId]   = useState(null);
  const [fileError,    setFileError]    = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  // Update-from-file state: { listId, listName, existingWords, incomingWords } | null
  const [diffData,     setDiffData]     = useState(null);
  // Edit-word state: { word, listId } | null
  const [editWord,     setEditWord]     = useState(null);
  // Which list's words are expanded for editing: listId | null
  const [expandedListId, setExpandedListId] = useState(null);
  const [expandedWords,  setExpandedWords]  = useState([]);
  const [expandLoading,  setExpandLoading]  = useState(false);

  // Separate file input ref and target-list ref for the "Update from File" flow.
  // Using a dedicated ref for the target list is safer than storing it as a
  // custom property on the DOM ref object.
  const updateFileRef     = useRef();
  const updateTargetList  = useRef(null);
  // Session cache: { [listId]: words[] } — avoids re-fetching on every
  // expand/collapse. Entries are updated after a word save and invalidated
  // after an apply_list_update so the user always sees fresh data.
  const listWordsCache    = useRef({});

  const { fileRef, handleFile } = useFilePicker(
    parsed => { setFileError(''); setPreview(parsed); setListName(`Shared List ${new Date().toLocaleDateString()}`); },
    msg    => setFileError(msg)
  );

  useEffect(() => {
    setLoading(true);
    DB.wordLists.getAdminLists()
      .then(setAdminLists).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function confirmImport() {
    if (!preview || !listName.trim()) return;
    setImporting(true); setImportMsg('');
    try {
      const list = await DB.wordLists.import(profile.id, listName, preview.words, 'admin', null);
      setAdminLists(prev => [
        { id: list.id, name: list.name, description: '', createdAt: new Date().toISOString(),
          scope: 'admin', wordCount: preview.words.length, activeChildCount: 0 },
        ...prev
      ]);
      setImportMsg(`✅ Imported ${preview.words.length} words to the shared library.`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setImportMsg('❌ Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleRename(list, newName) {
    if (!newName.trim()) return;
    try {
      await DB.wordLists.rename(list.id, newName.trim(), 'admin', null);
      setAdminLists(prev => prev.map(l => l.id === list.id ? { ...l, name: newName.trim() } : l));
    } catch (e) {
      showToast?.('Could not rename list — ' + e.message, 'error');
    }
  }

  // Debounced description save
  const descTimers = useRef({});
  // Clear any pending description timers when AdminWordLists unmounts
  // to prevent stale DB writes against a component that's no longer mounted.
  useEffect(() => () => {
    Object.values(descTimers.current).forEach(clearTimeout);
  }, []);
  function handleDescriptionChange(listId, value) {
    setAdminLists(prev => prev.map(l => l.id === listId ? { ...l, description: value } : l));
    if (descTimers.current[listId]) clearTimeout(descTimers.current[listId]);
    descTimers.current[listId] = setTimeout(async () => {
      try { await DB.wordLists.updateDescription(listId, value, 'admin', null); }
      catch (e) { showToast?.('Could not save description — ' + e.message, 'error'); }
    }, 1000);
  }

  function handleDelete(list) {
    const n = list.activeChildCount || 0;
    const warning = n > 0
      ? `⚠️ ${n} child${n !== 1 ? 'ren' : ''} currently use${n === 1 ? 's' : ''} this list and will be left with no active list.`
      : '';
    setConfirmDialog({
      title:        '🗑️ Delete from Library',
      message:      `Delete "${list.name}" from the shared library? This cannot be undone.${warning ? ' ' + warning : ''}`,
      confirmLabel: 'Delete',
      variant:      'danger',
      onConfirm:    async () => {
        setDeletingId(list.id);
        try {
          await DB.wordLists.delete(list.id, 'admin', null);
          setAdminLists(prev => prev.filter(l => l.id !== list.id));
          setConfirmDialog(null);
        } finally { setDeletingId(null); }
      },
    });
  }

  // "Update from File" flow
  function handleUpdateFile(list, file) {
    if (!file) return;
    const process = (data) => {
      const words = parseToWords(data);
      if (!words || words.length === 0) {
        showToast?.('No valid words found. Check column headers.', 'error');
        return;
      }
      applyNormalization(words);
      // Fetch existing words then open diff modal
      DB.wordLists.getListWords(list.id).then(existing => {
        setDiffData({ listId: list.id, listName: list.name, existingWords: existing, incomingWords: words });
      }).catch(e => showToast?.('Could not load list — ' + e.message, 'error'));
    };
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = async e => {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(e.target.result);
        const ws = wb.worksheets[0];
        const rows = [];
        ws.eachRow(row => rows.push(row.values.slice(1))); // slice off index-0 null
        process(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target.result;
        const delim = text.split('\n')[0].includes('|') ? '|' : ',';
        process(parseDSV(text, delim));
      };
      reader.readAsText(file);
    }
    // Reset file input so the same file can be re-selected
    if (updateFileRef.current) updateFileRef.current.value = '';
  }

  // Expand/collapse word list for editing.
  // Serves from listWordsCache on re-expand so repeated open/close
  // doesn't re-fetch. Cache entries are updated by handleWordSaved
  // and invalidated by the onApplied callback after a bulk update.
  async function toggleWordList(listId) {
    if (expandedListId === listId) {
      setExpandedListId(null);
      setExpandedWords([]);
      return;
    }
    setExpandedListId(listId);
    if (listWordsCache.current[listId]) {
      setExpandedWords(listWordsCache.current[listId]);
      return;
    }
    setExpandLoading(true);
    try {
      const words = await DB.wordLists.getListWords(listId);
      listWordsCache.current[listId] = words;
      setExpandedWords(words);
    } catch (e) {
      showToast?.('Could not load words — ' + e.message, 'error');
      setExpandedListId(null);
    } finally { setExpandLoading(false); }
  }

  function handleWordSaved(updatedWord, listId) {
    const updated = prev => prev.map(w => w.wordId === updatedWord.wordId ? updatedWord : w);
    setExpandedWords(updated);
    // Keep the session cache in sync so re-expand shows the edited word
    if (listWordsCache.current[listId]) {
      listWordsCache.current[listId] = updated(listWordsCache.current[listId]);
    }
    setEditWord(null);
    refreshWordListIfOnList(listId);
  }

  return (
    <>
      <h1 style={{ marginBottom:6 }}>Word Lists</h1>
      <p style={{ marginBottom:28 }}>Manage the shared library available to all users.</p>

      {/* Overview panel */}
      <AdminOverview />

      {/* Import new list */}
      <div className="card" style={{ marginBottom:24, textAlign:'center' }}>
        <div style={{ fontSize:'2.5rem', marginBottom:12 }}>📂</div>
        <h3 style={{ marginBottom:8 }}>Import to Shared Library</h3>
        <p style={{ fontSize:'0.88rem', marginBottom:16 }}>
          Accepts .csv, .txt, or .xlsx — needs a <code>word</code> column. Optionally include <code>status</code> (correct/incorrect), <code>rating</code> (2-5), <code>normalized_word</code>, and <code>normalized_pronunciation</code> to import progress.
        </p>
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls"
          style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
          Choose File
        </button>
      </div>

      {preview && (
        <ImportPreview
          preview={preview} listName={listName} setListName={setListName}
          onConfirm={confirmImport} onCancel={() => { setPreview(null); if(fileRef.current) fileRef.current.value=''; }}
          importing={importing} />
      )}

      {importMsg && (
        <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:20,
          fontSize:'0.9rem', fontWeight:600,
          background: importMsg.startsWith('✅') ? '#e3fff2' : '#ffecec',
          color:      importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)',
          border:    `1px solid ${importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)'}` }}>
          {importMsg}
        </div>
      )}

      {fileError && (
        <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:20,
          fontSize:'0.9rem', fontWeight:600, background:'#ffecec',
          color:'var(--danger)', border:'1px solid var(--danger)' }}>
          ⚠️ {fileError}
          <button onClick={() => setFileError('')} style={{ marginLeft:8, background:'none',
            border:'none', cursor:'pointer', color:'inherit', fontWeight:700 }}>✕</button>
        </div>
      )}

      {/* Hidden file input for "Update from File" */}
      <input ref={updateFileRef} type="file" accept=".csv,.txt,.xlsx,.xls"
        style={{ display:'none' }}
        onChange={e => {
          // updateTargetList is set just before clicking
          handleUpdateFile(updateTargetList.current, e.target.files[0]);
        }} />

      {/* Shared library */}
      <div className="card">
        <h3 style={{ marginBottom:16 }}>Shared Library</h3>
        {loading && <p style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>Loading…</p>}
        {!loading && adminLists.length === 0 && (
          <p style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>
            No shared lists yet. Import one above.
          </p>
        )}
        {adminLists.map(list => (
          <div key={list.id}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'12px 0',
              borderBottom:'1px solid var(--border)',
              opacity: deletingId === list.id ? 0.4 : 1 }}>

              {/* List info + description */}
              <div style={{ flex:1 }}>
                <ListRow list={list} deletingId={deletingId}
                  onRename={handleRename} onDelete={handleDelete}
                  extra={
                    <span style={{ fontSize:'0.78rem', color:'var(--text-muted)',
                      background:'var(--bg)', padding:'2px 8px', borderRadius:50,
                      border:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                      {list.activeChildCount || 0} children
                    </span>
                  } />
                <textarea
                  value={list.description || ''}
                  onChange={e => handleDescriptionChange(list.id, e.target.value)}
                  placeholder="Add a description (optional)…"
                  rows={2}
                  style={{ width:'100%', marginTop:6, padding:'6px 10px', borderRadius:8,
                    border:'1px solid var(--border)', fontFamily:'var(--font)',
                    fontSize:'0.82rem', resize:'vertical', background:'var(--bg)',
                    color:'var(--text)' }} />
                {/* Word list expander */}
                <button className="btn btn-ghost btn-sm"
                  style={{ marginTop:6, fontSize:'0.78rem' }}
                  onClick={() => toggleWordList(list.id)}>
                  {expandedListId === list.id ? '▲ Hide words' : '▼ Edit words'}
                </button>
                {/* Update from file button */}
                <button className="btn btn-outline btn-sm"
                  style={{ marginTop:6, marginLeft:8, fontSize:'0.78rem' }}
                  onClick={() => {
                    updateTargetList.current = list;
                    updateFileRef.current?.click();
                  }}>
                  🔄 Update from File
                </button>
              </div>
            </div>

            {/* Expanded word list */}
            {expandedListId === list.id && (
              <div style={{ padding:'8px 0 16px 16px' }}>
                {expandLoading
                  ? <p style={{ color:'var(--text-muted)', fontSize:'0.85rem' }}>Loading words…</p>
                  : expandedWords.length === 0
                    ? <p style={{ color:'var(--text-muted)', fontSize:'0.85rem' }}>No words.</p>
                    : expandedWords.map(w => (
                        <div key={w.wordId} style={{ display:'flex', alignItems:'center',
                          gap:10, padding:'4px 0', borderBottom:'1px solid var(--border)' }}>
                          <span style={{ flex:1, fontWeight:600, fontSize:'0.88rem' }}>
                            {w.word}
                            {w.hasOverride && <span style={{ color:'var(--warning)',
                              fontSize:'0.75rem', marginLeft:6 }}>✎ edited</span>}
                          </span>
                          <span style={{ fontSize:'0.78rem', color:'var(--text-muted)',
                            flex:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {w.definition}
                          </span>
                          <button className="btn btn-ghost btn-sm"
                            style={{ fontSize:'0.75rem', flexShrink:0 }}
                            onClick={() => setEditWord({ word: w, listId: list.id })}>
                            ✏️
                          </button>
                        </div>
                      ))
                }
              </div>
            )}
          </div>
        ))}
      </div>

      {confirmDialog && (
        <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}

      {diffData && (
        <ImportDiffModal
          listId={diffData.listId}
          listName={diffData.listName}
          existingWords={diffData.existingWords}
          incomingWords={diffData.incomingWords}
          onClose={() => setDiffData(null)}
          onApplied={newCount => {
            setAdminLists(prev => prev.map(l =>
              l.id === diffData.listId ? { ...l, wordCount: newCount } : l
            ));
            // Invalidate and refresh the cache entry if this list is expanded
            delete listWordsCache.current[diffData.listId];
            if (expandedListId === diffData.listId) {
              DB.wordLists.getListWords(diffData.listId).then(words => {
                listWordsCache.current[diffData.listId] = words;
                setExpandedWords(words);
              }).catch(() => {});
            }
            // Refresh in-context word list for any child currently on this list
            refreshWordListIfOnList(diffData.listId);
            setDiffData(null);
            showToast?.('Changes applied successfully.', 'success');
          }} />
      )}

      {editWord && (
        <WordEditModal
          word={editWord.word}
          listId={editWord.listId}
          onClose={() => setEditWord(null)}
          onSaved={w => handleWordSaved(w, editWord.listId)} />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PARENT VIEW
// ══════════════════════════════════════════════════════════════════════════════
function ParentWordLists({ profile }) {
  const { childList, applyImportedWordList, refreshWordListIfOnList } = useApp();
  const showToast = useToast();

  const [adminLists,   setAdminLists]   = useState([]);
  // { childId: [listMeta, …] }
  const [childLists,   setChildLists]   = useState({});
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState('');
  const [retryCount,   setRetryCount]   = useState(0);
  const [preview,      setPreview]      = useState(null);
  const [listName,     setListName]     = useState('');
  const [selectedChild, setSelectedChild] = useState('');
  const [importing,    setImporting]    = useState(false);
  const [importMsg,    setImportMsg]    = useState('');
  const [deletingId,   setDeletingId]   = useState(null);
  const [fileError,    setFileError]    = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [showAddWords, setShowAddWords] = useState(null); // child id | null
  const [activeSection, setActiveSection] = useState('shared'); // 'shared'|'import'|'manual'
  // { word, listId } | null — word being edited
  const [editWord,      setEditWord]      = useState(null);
  // listId | null — which child-scope list is expanded to show words
  const [expandedListId, setExpandedListId] = useState(null);
  const [expandedWords,  setExpandedWords]  = useState([]);
  const [expandLoading,  setExpandLoading]  = useState(false);
  const listWordsCache   = useRef({});

  const { fileRef, handleFile } = useFilePicker(
    parsed => { setFileError(''); setPreview(parsed); setListName(`Word List ${new Date().toLocaleDateString()}`); },
    msg    => setFileError(msg)
  );

  // Stable key: re-fetch only when the set of child IDs actually changes, or
  // when the user manually retries. Using the array reference directly would
  // re-fire if AppContext ever reconstructs the array without changing membership.
  const childIdsKey = childList.map(c => c.id).join(',');

  // Load admin lists + per-child lists on mount (retryCount bumps the dep to re-run)
  useEffect(() => {
    setLoadError('');
    if (!childList.length) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      DB.wordLists.getAdminLists(),
      ...childList.map(c => DB.wordLists.getChildLists(c.id).then(lists => ({ childId: c.id, lists })))
    ]).then(([admin, ...perChild]) => {
      setAdminLists(admin);
      const map = {};
      perChild.forEach(({ childId, lists }) => { map[childId] = lists; });
      setChildLists(map);
    }).catch(e => setLoadError(e.message || 'Failed to load word lists.'))
      .finally(() => setLoading(false));
    if (!selectedChild && childList.length > 0) setSelectedChild(childList[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childIdsKey, retryCount]);

  async function confirmImport() {
    if (!preview || !listName.trim() || !selectedChild) return;
    setImporting(true); setImportMsg('');
    try {
      const list = await DB.wordLists.import(profile.id, listName, preview.words, 'child', selectedChild);
      const newEntry = { id: list.id, name: list.name, createdAt: new Date().toISOString(),
        scope: 'child', wordCount: preview.words.length };
      setChildLists(prev => ({ ...prev, [selectedChild]: [newEntry, ...(prev[selectedChild] || [])] }));
      applyImportedWordList(preview.words, selectedChild);
      setImportMsg(`✅ Imported ${preview.words.length} words for ${childList.find(c => c.id === selectedChild)?.name}.`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setImportMsg('❌ Import failed: ' + e.message);
    } finally { setImporting(false); }
  }

  async function handleRename(list, newName) {
    if (!newName.trim()) return;
    try {
      await DB.wordLists.rename(list.id, newName.trim(), list.scope, list.ownerId);
      setChildLists(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(cid => {
          next[cid] = next[cid].map(l => l.id === list.id ? { ...l, name: newName.trim() } : l);
        });
        return next;
      });
    } catch (e) {
      showToast?.('Could not rename list — ' + e.message, 'error');
    }
  }

  function handleDelete(list, childId) {
    setConfirmDialog({
      title:        '🗑️ Delete Word List',
      message:      `Delete "${list.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant:      'danger',
      onConfirm:    async () => {
        setDeletingId(list.id);
        try {
          await DB.wordLists.delete(list.id, 'child', childId);
          setChildLists(prev => ({ ...prev, [childId]: (prev[childId] || []).filter(l => l.id !== list.id) }));
          setConfirmDialog(null);
        } finally { setDeletingId(null); }
      },
    });
  }

  async function toggleWordList(listId) {
    if (expandedListId === listId) {
      setExpandedListId(null); setExpandedWords([]); return;
    }
    setExpandedListId(listId);
    if (listWordsCache.current[listId]) {
      setExpandedWords(listWordsCache.current[listId]);
      return;
    }
    setExpandLoading(true);
    try {
      const words = await DB.wordLists.getListWords(listId);
      listWordsCache.current[listId] = words;
      setExpandedWords(words);
    } catch (e) {
      showToast?.('Could not load words — ' + e.message, 'error');
      setExpandedListId(null);
    } finally { setExpandLoading(false); }
  }

  function handleWordSaved(updatedWord, listId) {
    const updated = prev => prev.map(w => w.wordId === updatedWord.wordId ? updatedWord : w);
    setExpandedWords(updated);
    if (listWordsCache.current[listId]) {
      listWordsCache.current[listId] = updated(listWordsCache.current[listId]);
    }
    setEditWord(null);
    refreshWordListIfOnList(listId);
  }

  function handleWordsAdded(childId, newList) {
    setChildLists(prev => ({
      ...prev,
      [childId]: [{ id: newList.id, name: newList.name,
        createdAt: new Date().toISOString(), scope: 'child', wordCount: newList.wordCount },
        ...(prev[childId] || [])]
    }));
  }

  if (loading)   return <div className="loading-screen"><div className="spinner" /></div>;
  if (loadError) return (
    <div className="empty-state">
      <div className="icon">⚠️</div>
      <h3>Could not load word lists</h3>
      <p style={{ marginBottom:20 }}>{loadError}</p>
      <button className="btn btn-primary"
        onClick={() => setRetryCount(n => n + 1)}>Try Again</button>
    </div>
  );

  const activeChildObj = childList.find(c => c.id === selectedChild);

  return (
    <>
      <h1 style={{ marginBottom:6 }}>Word Lists</h1>
      <p style={{ marginBottom:20 }}>Manage word lists for your children.</p>

      {childList.length === 0 ? (
        <div className="empty-state">
          <div className="icon">👧</div>
          <h3>No children added yet</h3>
          <p>Add a child from the Home page first.</p>
        </div>
      ) : (
      <>
      {/* ── Child selector tabs ── */}
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
        {childList.map(c => (
          <button key={c.id}
            className={`btn btn-sm ${selectedChild === c.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setSelectedChild(c.id)}>
            {c.avatar} {c.name}
          </button>
        ))}
      </div>

      {/* ── Active list banner for selected child ── */}
      {activeChildObj && (() => {
        const activeName = (childLists[activeChildObj.id] || []).find(l => l.active)?.name
          || adminLists.find(l => l.active)?.name;
        return null; // active list shown via AssignListModal on Home
      })()}

      {/* ── Section tabs ── */}
      {activeChildObj && (
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {[['shared','📚 Shared Library'],['import','📂 Import File'],['manual','✏️ Enter Words']].map(([id,label]) => (
          <button key={id}
            className={`btn btn-sm ${activeSection === id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveSection(id)}>{label}</button>
        ))}
      </div>
      )}

      {activeChildObj && activeSection === 'shared' && (
      <div className="card" style={{ marginBottom:20 }}>
        <h3 style={{ marginBottom:12 }}>📚 Shared Library</h3>
        {adminLists.length === 0
          ? <p style={{ fontSize:'0.85rem', color:'var(--text-muted)' }}>No shared lists available yet. Ask the admin to import one.</p>
          : adminLists.map(list => (
            <div key={list.id} style={{ padding:'12px 0', borderBottom:'1px solid var(--border)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ flex:1 }}>
                  <p style={{ fontWeight:700, margin:'0 0 2px' }}>{list.name}</p>
                  {list.description && <p style={{ fontSize:'0.78rem', color:'var(--text)', margin:'0 0 2px' }}>{list.description}</p>}
                  <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', margin:0 }}>{list.wordCount ?? '?'} words</p>
                </div>
                <button className="btn btn-primary btn-sm"
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true); setImportMsg('');
                    try {
                      await DB.wordLists.assignToChild(selectedChild, list.id);
                      applyImportedWordList([], selectedChild);
                      setImportMsg(`✅ "${list.name}" is now ${activeChildObj.name}'s active list.`);
                    } catch(e) { setImportMsg('❌ ' + e.message); }
                    finally { setImporting(false); }
                  }}>
                  {importing ? '…' : 'Select This List'}
                </button>
              </div>
            </div>
          ))}
        {importMsg && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, fontSize:'0.88rem', fontWeight:600,
            background: importMsg.startsWith('✅') ? '#e3fff2' : '#ffecec',
            color: importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)',
            border: `1px solid ${importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)'}` }}>
            {importMsg}
          </div>
        )}
      </div>
      )}

      {activeChildObj && activeSection === 'import' && (
      <div className="card" style={{ marginBottom:20 }}>
        <h3 style={{ marginBottom:12 }}>📂 Import Word List for {activeChildObj.avatar} {activeChildObj.name}</h3>
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls"
          style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Choose File</button>
        {fileError && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, fontSize:'0.88rem',
            fontWeight:600, background:'#ffecec', color:'var(--danger)', border:'1px solid var(--danger)' }}>
            ⚠️ {fileError}
            <button onClick={() => setFileError('')} style={{ marginLeft:8, background:'none',
              border:'none', cursor:'pointer', color:'inherit', fontWeight:700 }}>✕</button>
          </div>
        )}
        {preview && (
          <div style={{ marginTop:16 }}>
            <ImportPreview
              preview={preview} listName={listName} setListName={setListName}
              onConfirm={confirmImport}
              onCancel={() => { setPreview(null); if(fileRef.current) fileRef.current.value=''; }}
              importing={importing}
              notice={`This will be assigned to ${activeChildObj.name} as their active list.`} />
          </div>
        )}
        {importMsg && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, fontSize:'0.88rem', fontWeight:600,
            background: importMsg.startsWith('✅') ? '#e3fff2' : '#ffecec',
            color: importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)',
            border: `1px solid ${importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)'}` }}>
            {importMsg}
          </div>
        )}
        {/* Personal lists for this child */}
        {(childLists[selectedChild] || []).length > 0 && (
          <div style={{ marginTop:20 }}>
            <h4 style={{ marginBottom:10, fontSize:'0.9rem', color:'var(--text-muted)' }}>Previous imports</h4>
            {(childLists[selectedChild] || []).map(list => (
              <div key={list.id}>
                <div style={{ display:'flex', alignItems:'center' }}>
                  <div style={{ flex:1 }}>
                    <ListRow list={{ ...list, ownerId: selectedChild }}
                      deletingId={deletingId} onRename={handleRename}
                      onDelete={l => handleDelete(l, selectedChild)} />
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.75rem' }}
                    onClick={() => toggleWordList(list.id)}>
                    {expandedListId === list.id ? '▲ Hide' : '▼ Edit Words'}
                  </button>
                </div>
                {expandedListId === list.id && (
                  <div style={{ padding:'8px 0 12px 12px' }}>
                    {expandLoading ? <p style={{ color:'var(--text-muted)', fontSize:'0.85rem' }}>Loading…</p>
                      : expandedWords.map(w => (
                        <div key={w.wordId} style={{ display:'flex', alignItems:'center', gap:8,
                          padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
                          <span style={{ flex:1, fontWeight:600, fontSize:'0.85rem' }}>{w.word}</span>
                          <span style={{ fontSize:'0.78rem', color:'var(--text-muted)', flex:2,
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{w.definition}</span>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.72rem' }}
                            onClick={() => setEditWord({ word: w, listId: list.id })}>✏️</button>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {activeChildObj && activeSection === 'manual' && (
      <div className="card" style={{ marginBottom:20 }}>
        <h3 style={{ marginBottom:12 }}>✏️ Enter Words for {activeChildObj.avatar} {activeChildObj.name}</h3>
        <button className="btn btn-primary" onClick={() => setShowAddWords(selectedChild)}>
          + Add Words Manually
        </button>
      </div>
      )}
      </>
      )}
      {!activeChildObj && (
        <p style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>Select a child above to manage their word lists.</p>
      )}

      {showAddWords && (
        <AddWordsModal
          childId={showAddWords}
          childName={childList.find(c => c.id === showAddWords)?.name || ''}
          createdBy={profile.id}
          onClose={() => setShowAddWords(null)}
          onSaved={newList => { handleWordsAdded(showAddWords, newList); setShowAddWords(null); }}
        />
      )}

      {confirmDialog && (
        <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}

      {editWord && (
        <WordEditModal word={editWord.word} listId={editWord.listId}
          onClose={() => setEditWord(null)}
          onSaved={w => handleWordSaved(w, editWord.listId)} />
      )}

      {showAddWords && (
        <AddWordsModal
          childId={showAddWords}
          childName={childList.find(c => c.id === showAddWords)?.name || ''}
          createdBy={profile.id}
          onClose={() => setShowAddWords(null)}
          onSaved={newList => { handleWordsAdded(showAddWords, newList); setShowAddWords(null); }}
        />
      )}
    </>
  );
}

// Defined outside KidWordLists so React doesn't create a new component type
// on every render — avoids unnecessary unmount/remount of the button during
// the assign flow when assigningId state updates.
function AssignBtn({ listId, assigningId, onAssign }) {
  return (
    <button className="btn btn-outline btn-sm"
      onClick={() => onAssign(listId)}
      disabled={!!assigningId}>
      {assigningId === listId ? '…' : '▶ Use This'}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// KID VIEW (kid with their own login)
// ══════════════════════════════════════════════════════════════════════════════
function KidWordLists({ profile }) {
  const { assignChildList } = useApp();
  const showToast = useToast();
  const [adminLists,  setAdminLists]  = useState([]);
  const [myLists,     setMyLists]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [preview,     setPreview]     = useState(null);
  const [listName,    setListName]    = useState('');
  const [importing,   setImporting]   = useState(false);
  const [importMsg,   setImportMsg]   = useState('');
  const [deletingId,  setDeletingId]  = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [fileError,   setFileError]   = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [showAddWords, setShowAddWords] = useState(false);

  const { fileRef, handleFile } = useFilePicker(
    parsed => { setFileError(''); setPreview(parsed); setListName(`My List ${new Date().toLocaleDateString()}`); },
    msg    => setFileError(msg)
  );

  useEffect(() => {
    Promise.all([
      DB.wordLists.getAdminLists(),
      DB.wordLists.getChildLists(profile.id)
    ]).then(([admin, mine]) => {
      setAdminLists(admin); setMyLists(mine);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [profile.id]);

  async function confirmImport() {
    if (!preview || !listName.trim()) return;
    setImporting(true); setImportMsg('');
    try {
      const list = await DB.wordLists.import(profile.id, listName, preview.words, 'child', profile.id);
      const entry = { id: list.id, name: list.name, createdAt: new Date().toISOString(),
        scope: 'child', wordCount: preview.words.length };
      setMyLists(prev => [entry, ...prev]);
      setImportMsg(`✅ Imported ${preview.words.length} words.`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setImportMsg('❌ Import failed: ' + e.message); }
    finally { setImporting(false); }
  }

  async function handleAssign(listId) {
    setAssigningId(listId);
    try {
      await assignChildList(profile.id, listId);
    } catch (e) {
      showToast?.('Could not assign list — ' + e.message, 'error');
    } finally { setAssigningId(null); }
  }

  function handleDelete(list) {
    setConfirmDialog({
      title:        '🗑️ Delete Word List',
      message:      `Delete "${list.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant:      'danger',
      onConfirm:    async () => {
        setDeletingId(list.id);
        try {
          await DB.wordLists.delete(list.id, 'child', profile.id);
          setMyLists(prev => prev.filter(l => l.id !== list.id));
          setConfirmDialog(null);
        } finally { setDeletingId(null); }
      },
    });
  }

  async function handleRename(list, newName) {
    if (!newName.trim()) return;
    try {
      await DB.wordLists.rename(list.id, newName.trim(), 'child', profile.id);
      setMyLists(prev => prev.map(l => l.id === list.id ? { ...l, name: newName.trim() } : l));
    } catch (e) {
      showToast?.('Could not rename list — ' + e.message, 'error');
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;


  return (
    <>
      <h1 style={{ marginBottom:6 }}>Word Lists</h1>
      <p style={{ marginBottom:28 }}>Manage your word lists and pick which one to practice.</p>

      {/* ── Import my own list ── */}
      <div className="card" style={{ marginBottom:24, textAlign:'center' }}>
        <div style={{ fontSize:'2.5rem', marginBottom:12 }}>📂</div>
        <h3 style={{ marginBottom:8 }}>Import a Word List</h3>
        <p style={{ fontSize:'0.88rem', marginBottom:16 }}>
          Accepts .csv, .txt, or .xlsx — needs a <code>word</code> column. Optionally include <code>status</code> (correct/incorrect), <code>rating</code> (2-5), <code>normalized_word</code>, and <code>normalized_pronunciation</code> to import progress.
        </p>
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls"
          style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
        <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
            Choose File
          </button>
          <button className="btn btn-outline" onClick={() => setShowAddWords(true)}>
            + Add Words Manually
          </button>
        </div>
      </div>

      {preview && (
        <ImportPreview preview={preview} listName={listName} setListName={setListName}
          onConfirm={confirmImport}
          onCancel={() => { setPreview(null); if(fileRef.current) fileRef.current.value=''; }}
          importing={importing} />
      )}

      {importMsg && (
        <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:20,
          fontSize:'0.9rem', fontWeight:600,
          background: importMsg.startsWith('✅') ? '#e3fff2' : '#ffecec',
          color:      importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)',
          border:    `1px solid ${importMsg.startsWith('✅') ? 'var(--secondary)' : 'var(--danger)'}` }}>
          {importMsg}
        </div>
      )}

      {/* ── My lists ── */}
      <div className="card" style={{ marginBottom:20 }}>
        <h3 style={{ marginBottom:16 }}>My Lists</h3>
        {myLists.length === 0
          ? <p style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>No personal lists yet.</p>
          : myLists.map(list => (
            <ListRow key={list.id} list={list} deletingId={deletingId}
              onRename={handleRename} onDelete={handleDelete}
              extra={<AssignBtn listId={list.id} assigningId={assigningId} onAssign={handleAssign} />} />
          ))}
      </div>

      {/* ── Shared library ── */}
      <div className="card">
        <h3 style={{ marginBottom:16 }}>📚 Shared Library</h3>
        {adminLists.length === 0
          ? <p style={{ color:'var(--text-muted)', fontSize:'0.88rem' }}>No shared lists available yet.</p>
          : adminLists.map(list => (
            <div key={list.id} style={{ display:'flex', alignItems:'center', gap:10,
              padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
              <div style={{ flex:1 }}>
                <p style={{ fontWeight:600, margin:0 }}>{list.name}</p>
                <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', margin:0 }}>
                  {list.wordCount ?? '?'} words
                </p>
              </div>
              <AssignBtn listId={list.id} assigningId={assigningId} onAssign={handleAssign} />
            </div>
          ))}
      </div>

      {fileError && (
        <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:20,
          fontSize:'0.9rem', fontWeight:600, background:'#ffecec',
          color:'var(--danger)', border:'1px solid var(--danger)' }}>
          ⚠️ {fileError}
          <button onClick={() => setFileError('')} style={{ marginLeft:8, background:'none',
            border:'none', cursor:'pointer', color:'inherit', fontWeight:700 }}>✕</button>
        </div>
      )}

      {showAddWords && (
        <AddWordsModal
          childId={profile.id}
          childName={profile.name}
          createdBy={profile.id}
          onClose={() => setShowAddWords(false)}
          onSaved={newList => {
            setMyLists(prev => [{ id: newList.id, name: newList.name,
              createdAt: new Date().toISOString(), scope: 'child',
              wordCount: newList.wordCount }, ...prev]);
            setShowAddWords(false);
          }}
        />
      )}

      {confirmDialog && (
        <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE ENTRY POINT — routes to the right view based on role
// ══════════════════════════════════════════════════════════════════════════════
export default function WordLists() {
  const { profile } = useApp();

  return (
    <Layout>
      {profile?.role === 'admin'  && <AdminWordLists  profile={profile} />}
      {profile?.role === 'parent' && <ParentWordLists profile={profile} />}
      {profile?.role === 'kid'    && <KidWordLists    profile={profile} />}
    </Layout>
  );
}
