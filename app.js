const STORAGE = {
  decks: 'anki-maker:decks',
  tags: 'anki-maker:tags',
  session: 'anki-maker:session',
  deckName: 'anki-maker:deckName',
  lang: 'anki-maker:lang',
};

let worker = null;
let workerReady = false;
let pendingRequests = {};
let requestId = 0;
let cards = [];
let currentTags = [];
let editingId = null;
let currentLang = 'en';
let sentenceLang = 'ja';

// ── i18n ──────────────────────────────────────────────────

function t(key) {
  return TRANSLATIONS[currentLang][key] ?? TRANSLATIONS.en[key] ?? key;
}

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem(STORAGE.lang, lang);
  document.documentElement.lang = lang;

  document.getElementById('langSelect').value = lang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  updateCardCountDisplay();
  updatePreview();
  renderCardList();

  if (editingId !== null) {
    document.getElementById('addCard').textContent = t('saveBtn');
  }
}


// ── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const savedLang = localStorage.getItem(STORAGE.lang) || 'en';
  loadFromStorage();
  initKuromoji();
  bindEvents();
  updateAutocomplete();
  applyLanguage(savedLang);
});

// ── Sentence language ─────────────────────────────────────

function setSentenceLang(lang) {
  sentenceLang = lang;
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === lang);
  });
  const readingRow = document.getElementById('readingRow');
  readingRow.style.display = lang === 'ja' ? '' : 'none';
  if (lang === 'en') {
    document.getElementById('reading').value = '';
    updatePreview();
  }
}

// ── Kuromoji Worker ───────────────────────────────────────

function initKuromoji() {
  if (worker) return;
  setStatus(t('loading'));

  try {
    worker = new Worker('kuromoji-worker.js');
  } catch (e) {
    setStatus(t('loadFail'));
    return;
  }

  const timeout = setTimeout(() => {
    if (!workerReady) setStatus(t('loadFail'));
  }, 30000);

  worker.addEventListener('message', (e) => {
    if (e.data.type === 'ready') {
      clearTimeout(timeout);
      workerReady = true;
      setStatus(t('loaded'));
      setTimeout(() => setStatus(''), 2000);
    } else if (e.data.type === 'error') {
      clearTimeout(timeout);
      setStatus(t('loadFail'));
    } else if (e.data.type === 'tokens') {
      const resolve = pendingRequests[e.data.id];
      if (resolve) {
        resolve(e.data.tokens);
        delete pendingRequests[e.data.id];
      }
    }
  });

  worker.onerror = () => {
    clearTimeout(timeout);
    setStatus(t('loadFail'));
  };
}

function setStatus(msg) {
  document.getElementById('tokenizerStatus').textContent = msg;
}

function katakanaToHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

function tokenize(sentence) {
  return new Promise((resolve) => {
    if (!workerReady) { resolve([]); return; }
    const id = requestId++;
    pendingRequests[id] = resolve;
    worker.postMessage({ type: 'tokenize', sentence, id });
  });
}

async function getReading(sentence, word) {
  if (!workerReady || !sentence || !word) return '';
  const tokens = await tokenize(sentence);
  let reading = '';
  let remaining = word;

  for (const token of tokens) {
    if (!remaining) break;
    if (remaining.startsWith(token.surface_form)) {
      reading += token.reading || token.surface_form;
      remaining = remaining.slice(token.surface_form.length);
    }
  }

  return remaining === '' ? katakanaToHiragana(reading) : '';
}

// ── Card content builders ─────────────────────────────────

function makeFront(sentence, word) {
  if (!sentence) return '';
  if (!word) return escapeHtml(sentence);
  const escapedWord = escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapeHtml(sentence).replace(
    new RegExp(escapedWord, 'g'),
    `<b>${escapeHtml(word)}</b>`
  );
}

function makeBack(word, reading, meaning) {
  let back = escapeHtml(word || '');
  if (reading) back += `[${escapeHtml(reading)}]`;
  if (meaning) back += `<br>${escapeHtml(meaning)}`;
  return back;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Preview ───────────────────────────────────────────────

function updatePreview() {
  const sentence = document.getElementById('sentence').value;
  const word = document.getElementById('targetWord').value;
  const reading = document.getElementById('reading').value;
  const meaning = document.getElementById('meaning').value;

  const frontHtml = makeFront(sentence, word);
  const backHtml = makeBack(word, reading, meaning);

  document.getElementById('previewFront').innerHTML =
    frontHtml || `<span class="preview-empty">${t('frontEmpty')}</span>`;
  document.getElementById('previewBack').innerHTML =
    backHtml || `<span class="preview-empty">${t('backEmpty')}</span>`;
}

// ── Events ────────────────────────────────────────────────

function bindEvents() {
  let readingTimer;

  function triggerAutoReading() {
    clearTimeout(readingTimer);
    readingTimer = setTimeout(async () => {
      if (sentenceLang === 'ja') {
        const sentence = document.getElementById('sentence').value;
        const word = document.getElementById('targetWord').value;
        if (sentence && word && workerReady) {
          const r = await getReading(sentence, word);
          if (r) document.getElementById('reading').value = r;
        }
      }
      updatePreview();
    }, 300);
  }

  document.getElementById('sentence').addEventListener('input', triggerAutoReading);
  document.getElementById('targetWord').addEventListener('input', triggerAutoReading);
  document.getElementById('reading').addEventListener('input', updatePreview);
  document.getElementById('meaning').addEventListener('input', updatePreview);

  document.getElementById('autoReading').addEventListener('click', async () => {
    const sentence = document.getElementById('sentence').value;
    const word = document.getElementById('targetWord').value;

    if (!worker) {
      initKuromoji();
      setStatus(t('stillLoading'));
      return;
    }
    if (!workerReady) {
      setStatus(t('stillLoading'));
      return;
    }
    const r = await getReading(sentence, word);
    if (r) {
      document.getElementById('reading').value = r;
      updatePreview();
    } else {
      setStatus(t('notFound'));
      setTimeout(() => setStatus(''), 2500);
    }
  });

  document.getElementById('tagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !currentTags.includes(val)) {
        currentTags.push(val);
        renderCurrentTags();
      }
      e.target.value = '';
    }
  });

  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => setSentenceLang(btn.dataset.value));
  });

  document.getElementById('addCard').addEventListener('click', submitCard);
  document.getElementById('clearAll').addEventListener('click', clearAllCards);
  document.getElementById('exportCSV').addEventListener('click', exportCSV);
  document.getElementById('langSelect').addEventListener('change', (e) => applyLanguage(e.target.value));

  document.getElementById('deckName').addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (!val) return;
    localStorage.setItem(STORAGE.deckName, JSON.stringify(val));
    pushHistory('decks', val);
    updateAutocomplete();
  });
}

// ── Tags ──────────────────────────────────────────────────

function renderCurrentTags() {
  document.getElementById('currentTags').innerHTML = currentTags
    .map(tag => `<span class="tag">${escapeHtml(tag)}<button onclick="removeTag('${escapeHtml(tag)}')">&times;</button></span>`)
    .join('');
}

function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderCurrentTags();
}

// ── Card CRUD ─────────────────────────────────────────────

function submitCard() {
  const sentence = document.getElementById('sentence').value.trim();
  const word = document.getElementById('targetWord').value.trim();
  const reading = document.getElementById('reading').value.trim();
  const meaning = document.getElementById('meaning').value.trim();

  if (!sentence || !word || !meaning) {
    alert(t('alertRequired'));
    return;
  }

  if (editingId !== null) {
    const idx = cards.findIndex(c => c.id === editingId);
    if (idx !== -1) {
      cards[idx] = { id: editingId, sentence, word, reading, meaning, tags: [...currentTags] };
    }
    editingId = null;
    document.getElementById('addCard').textContent = t('addCardBtn');
  } else {
    cards.push({ id: Date.now(), sentence, word, reading, meaning, tags: [...currentTags] });
  }

  currentTags.forEach(tag => pushHistory('tags', tag));
  updateAutocomplete();
  clearForm();
  saveCards();
  renderCardList();
}

function clearForm() {
  document.getElementById('sentence').value = '';
  document.getElementById('targetWord').value = '';
  document.getElementById('reading').value = '';
  document.getElementById('meaning').value = '';
  currentTags = [];
  renderCurrentTags();
  updatePreview();
}

function clearAllCards() {
  if (cards.length === 0) return;
  if (!confirm(t('confirmClearAll'))) return;
  cards = [];
  saveCards();
  renderCardList();
}

function deleteCard(id) {
  if (!confirm(t('confirmDelete'))) return;
  cards = cards.filter(c => c.id !== id);
  saveCards();
  renderCardList();
}

function editCard(id) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  document.getElementById('sentence').value = card.sentence;
  document.getElementById('targetWord').value = card.word;
  document.getElementById('reading').value = card.reading;
  document.getElementById('meaning').value = card.meaning;
  currentTags = [...card.tags];
  renderCurrentTags();
  updatePreview();

  editingId = id;
  document.getElementById('addCard').textContent = t('saveBtn');
  document.querySelector('.card-form').scrollIntoView({ behavior: 'smooth' });
}

// ── Render ────────────────────────────────────────────────

function updateCardCountDisplay() {
  const count = cards.length;
  const prefix = t('cardCountPrefix');
  const suffix = t('cardCountSuffix');
  // en: "Card List · 3"  ko: "카드 목록 3장"
  const sep = currentLang === 'en' ? ' · ' : ' ';
  document.getElementById('cardListTitle').innerHTML =
    `${t('cardList')}${sep}<span class="count">${count}</span>${suffix ? `<span class="count-suffix">${suffix}</span>` : ''}`;
}

function renderCardList() {
  const container = document.getElementById('cardList');
  updateCardCountDisplay();

  if (cards.length === 0) {
    container.innerHTML = `<p class="empty">${t('empty')}</p>`;
    return;
  }

  container.innerHTML = cards.map((card, i) => `
    <div class="card-item">
      <div class="card-number">${i + 1}</div>
      <div class="card-content">
        <div class="card-front">${makeFront(card.sentence, card.word)}</div>
        <div class="card-back">${makeBack(card.word, card.reading, card.meaning)}</div>
        ${card.tags.length ? `<div class="card-tags">${card.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn-edit" onclick="editCard(${card.id})">${t('edit')}</button>
        <button class="btn-delete" onclick="deleteCard(${card.id})">${t('delete')}</button>
      </div>
    </div>
  `).join('');
}

// ── CSV Export ────────────────────────────────────────────

function exportCSV() {
  if (cards.length === 0) {
    alert(t('alertEmpty'));
    return;
  }

  const deckName = document.getElementById('deckName').value.trim() || 'anki-deck';

  const rows = [
    '#separator:comma',
    '#html:true',
    `#deck:${deckName}`,
    '#notetype:Basic',
  ];

  cards.forEach(card => {
    const front = makeFront(card.sentence, card.word).replace(/"/g, '""');
    const back = makeBack(card.word, card.reading, card.meaning).replace(/"/g, '""');
    const tags = card.tags.join(' ').replace(/"/g, '""');
    rows.push(`"${front}","${back}","${tags}"`);
  });

  const csv = rows.join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deckName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── LocalStorage ──────────────────────────────────────────

function saveCards() {
  localStorage.setItem(STORAGE.session, JSON.stringify(cards));
}

function loadFromStorage() {
  const savedCards = localStorage.getItem(STORAGE.session);
  if (savedCards) cards = JSON.parse(savedCards);

  const savedDeck = localStorage.getItem(STORAGE.deckName);
  if (savedDeck) document.getElementById('deckName').value = JSON.parse(savedDeck);
}

function pushHistory(type, value) {
  const key = STORAGE[type];
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  const updated = [value, ...list.filter(v => v !== value)].slice(0, 30);
  localStorage.setItem(key, JSON.stringify(updated));
}

function updateAutocomplete() {
  const decks = JSON.parse(localStorage.getItem(STORAGE.decks) || '[]');
  const tags = JSON.parse(localStorage.getItem(STORAGE.tags) || '[]');
  document.getElementById('deckList').innerHTML = decks.map(d => `<option value="${escapeHtml(d)}">`).join('');
  document.getElementById('tagList').innerHTML = tags.map(tag => `<option value="${escapeHtml(tag)}">`).join('');
}
