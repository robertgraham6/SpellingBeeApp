// ── Character normalisation helpers ──────────────────────────────────────────
// Used by db.js (import/load), WordLists.jsx (import preview),
// ImportDiffModal.jsx (diff keying), Review.jsx, and WordDetailModal.jsx.

/**
 * Normalise a spelling word to a stable lookup key:
 *   - Unicode NFC → NFD decomposition to separate base letters from diacritics
 *   - Strip combining diacritical marks (accents, umlauts, etc.)
 *   - Lowercase
 *   - Remove anything that is not a letter, digit, or hyphen
 *
 * Examples:
 *   "Naïve"   → "naive"
 *   "résumé"  → "resume"
 *   "co-opt"  → "co-opt"
 *   "épée"    → "epee"
 */
export function normalizeWord(word) {
  if (!word) return '';
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');       // keep letters, digits, hyphens only
}

/**
 * Normalise a pronunciation string for deduplication in the words table.
 * Less aggressive than normalizeWord — preserves hyphens and dots used in
 * IPA / pronunciation-respelling notation, but strips accents and lowercases.
 */
export function normalizePronunciation(pronunciation) {
  if (!pronunciation) return '';
  return pronunciation
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Mutate an array of word objects (as parsed from an import file) in place:
 *   1. Set `normalizedWord` on every entry.
 *   2. Detect duplicate normalised forms and auto-suffix them with _2, _3 …
 *      so each row gets a unique key in the words table.
 *
 * Returns an array of collision descriptors:
 *   [{ word: 'original surface form', assigned: 'normalised_2' }, …]
 *
 * A collision is only reported for the *second and later* occurrences —
 * the first occurrence keeps its natural normalised form unchanged.
 */
export function applyNormalization(words) {
  const seen = {};       // normalizedWord → count of times seen
  const collisions = [];

  words.forEach(w => {
    const base = normalizeWord(w.word);
    if (!seen[base]) {
      seen[base] = 1;
      w.normalizedWord = base;
    } else {
      seen[base] += 1;
      const assigned = `${base}_${seen[base]}`;
      w.normalizedWord = assigned;
      collisions.push({ word: w.word, assigned });
    }
  });

  return collisions;
}

/**
 * Returns true if a word has ever been answered incorrectly in the given
 * history snapshot.  Used by Review.jsx and WordDetailModal.jsx to highlight
 * words that need attention regardless of their current status.
 *
 * @param {object} word          - word object with a `wordId` property
 * @param {object} initialHistory - history map keyed by wordId,
 *                                  values are objects with a `status` string
 */
export function wasEverMissed(word, initialHistory) {
  const entry = initialHistory?.[word.wordId];
  return entry?.status === 'incorrect';
}
