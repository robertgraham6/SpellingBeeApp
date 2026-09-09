import { normalizeWord, normalizePronunciation } from './normalize.js';

export const AUDIO_BASE_URL = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AUDIO_BASE_URL) ||
  'https://spellingbeetest.online'
).replace(/\/+$/, '');

/**
 * Builds the canonical filename: {normalizedWord}_{normalizedPronunciation}.mp3
 * If pronunciation is omitted or empty: {normalizedWord}.mp3
 */
export function getAudioFilename(word) {
  if (!word) return '';
  const rawWord = typeof word === 'string' ? word : (word.normalizedWord || word.word || '');
  const rawPron = typeof word === 'string' ? '' : (word.normalizedPronunciation || word.pronunciation || '');

  const base = normalizeWord(rawWord).replace(/[^a-z0-9_\-]/g, '');
  const pron = normalizePronunciation(rawPron).replace(/[^a-z0-9_\-]/g, '');

  if (!base) return '';
  return pron ? `${base}_${pron}.mp3` : `${base}.mp3`;
}

/**
 * Generates an ordered list of candidate URLs to try for playback:
 * 1. Base URL directly (https://spellingbeetest.online/{filename})
 * 2. Base URL /audio/ path (https://spellingbeetest.online/audio/{filename})
 * 3. Fallback without pronunciation if pronunciation was included
 * 4. Local fallback (/audio/{filename})
 */
export function getAudioCandidateUrls(word) {
  if (!word) return [];

  const filename = getAudioFilename(word);
  if (!filename) return [];

  const urls = [];

  // If word object already has an explicit full URL audio link (e.g., from DB)
  if (typeof word === 'object' && word.audioLink && /^https?:\/\//i.test(word.audioLink)) {
    urls.push(word.audioLink);
  }

  // Primary candidates using https://spellingbeetest.online
  urls.push(`${AUDIO_BASE_URL}/${filename}`);
  urls.push(`${AUDIO_BASE_URL}/audio/${filename}`);

  // If filename had pronunciation, also try the base word without pronunciation
  const rawWord = typeof word === 'string' ? word : (word.normalizedWord || word.word || '');
  const baseOnly = normalizeWord(rawWord).replace(/[^a-z0-9_\-]/g, '');
  if (baseOnly && filename !== `${baseOnly}.mp3`) {
    urls.push(`${AUDIO_BASE_URL}/${baseOnly}.mp3`);
    urls.push(`${AUDIO_BASE_URL}/audio/${baseOnly}.mp3`);
  }

  // Local relative fallback
  urls.push(`/audio/${filename}`);
  if (baseOnly && filename !== `${baseOnly}.mp3`) {
    urls.push(`/audio/${baseOnly}.mp3`);
  }

  // Deduplicate
  return Array.from(new Set(urls));
}

let activeAudio = null;

export function stopCurrentAudio() {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = '';
      activeAudio.onended = null;
      activeAudio.onerror = null;
    } catch {
      // ignore
    }
    activeAudio = null;
  }
}

/**
 * Plays audio for a word, attempting candidate URLs sequentially on error.
 * Returns the HTMLAudioElement or null.
 */
export function playWordAudio(word, options = {}) {
  const { onStart, onEnd, onError, btnRef } = options;

  stopCurrentAudio();

  const candidateUrls = getAudioCandidateUrls(word);
  if (!candidateUrls.length) {
    if (onError) onError(new Error('No audio available'));
    return null;
  }

  if (btnRef?.current) btnRef.current.disabled = true;

  const audio = new Audio();
  activeAudio = audio;

  let index = 0;

  const cleanup = () => {
    if (btnRef?.current) btnRef.current.disabled = false;
    if (activeAudio === audio) activeAudio = null;
  };

  const tryNext = () => {
    if (activeAudio !== audio) return; // Superceded by another play request

    if (index >= candidateUrls.length) {
      cleanup();
      if (onError) onError(new Error('Failed to play audio from all sources'));
      return;
    }

    const currentUrl = candidateUrls[index++];
    let resolved = false;

    const onFail = (err) => {
      if (resolved) return;
      resolved = true;
      if (err?.name === 'AbortError') return;
      tryNext();
    };

    audio.onended = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (onEnd) onEnd();
    };

    audio.onerror = () => {
      onFail();
    };

    try {
      audio.src = currentUrl;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (onStart) onStart();
          })
          .catch(err => {
            onFail(err);
          });
      }
    } catch (err) {
      onFail(err);
    }
  };

  tryNext();
  return audio;
}
