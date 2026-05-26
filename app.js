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

  applyPlaceholders();

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

function applyPlaceholders() {
  const suffix = sentenceLang === 'en' ? 'En' : '';
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = t(key + suffix) || t(key);
  });
}

function setSentenceLang(lang) {
  sentenceLang = lang;
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === lang);
  });
  const readingRow = document.getElementById('readingRow');
  readingRow.style.display = lang === 'ja' ? '' : 'none';
  applyPlaceholders();
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
  document.getElementById('exportApkg').addEventListener('click', exportApkg);
  document.getElementById('importApkg').addEventListener('click', () => document.getElementById('importApkgFile').click());
  document.getElementById('importApkgFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importApkg(e.target.files[0]);
    e.target.value = '';
  });
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
// ── Anki .apkg Export ────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function fieldChecksum(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return parseInt(hex.slice(0, 8), 16);
}

function makeGuid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function exportApkg() {
  if (cards.length === 0) { alert(t('alertEmpty')); return; }

  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

    const SQL = await initSqlJs({
      locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`
    });

    const db = new SQL.Database();
    db.run(`CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)`);
    db.run(`CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld text not null, csum integer not null, flags integer not null, data text not null)`);
    db.run(`CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null)`);
    db.run(`CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null)`);
    db.run(`CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null)`);
    db.run(`CREATE INDEX ix_notes_usn on notes (usn)`);
    db.run(`CREATE INDEX ix_cards_usn on cards (usn)`);
    db.run(`CREATE INDEX ix_revlog_usn on revlog (usn)`);
    db.run(`CREATE INDEX ix_cards_nid on cards (nid)`);
    db.run(`CREATE INDEX ix_cards_sched on cards (did, queue, due)`);
    db.run(`CREATE INDEX ix_revlog_cid on revlog (cid)`);
    db.run(`CREATE INDEX ix_notes_csum on notes (csum)`);

    const now = Math.floor(Date.now() / 1000);
    const deckName = document.getElementById('deckName').value.trim() || 'Anki Deck';
    const modelId = Date.now();
    const deckId = modelId + 1;
    const isJa = sentenceLang === 'ja';

    const model = {
      id: modelId, name: 'Sentence Card', type: 0, mod: now, usn: -1, sortf: 0, did: null,
      tmpls: [{
        name: 'Card 1', ord: 0,
        qfmt: '{{Sentence}}',
        afmt: isJa
          ? '{{FrontSide}}<hr id=answer>{{Word}}[{{Reading}}]<br>{{Meaning}}'
          : '{{FrontSide}}<hr id=answer>{{Word}}<br>{{Meaning}}',
        did: null, bqfmt: '', bafmt: '', mod: 0, usn: 0,
      }],
      flds: [
        { name: 'Sentence', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Word',     ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Reading',  ord: 2, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Meaning',  ord: 3, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      ],
      css: '.card{font-family:Arial,sans-serif;font-size:20px;text-align:center;color:#000;background:#fff}b{color:#FF6600}',
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      req: [[0, 'any', [0]]], tags: [], vers: [],
    };

    const deck = {
      id: deckId, name: deckName, desc: '', mod: now, usn: -1,
      collapsed: false, browserCollapsed: false,
      newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
      conf: 1, extendNew: 10, extendRev: 50,
    };

    const dconf = {
      '1': {
        id: 1, name: 'Default', replayq: true,
        lapse: { leechFails: 8, minInt: 1, delays: [10], leechAction: 0, mult: 0 },
        rev: { perDay: 100, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: true },
        timer: 0, maxTaken: 60, usn: 0,
        new: { perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7], initialFactor: 2500, bury: true, order: 1 },
        mod: 0, autoplay: true,
      },
    };

    db.run(`INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      1, now, now, Date.now(), 11, 0, -1, 0,
      JSON.stringify({ nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0, sortBackwards: false, addToCur: true, curDeck: 1, newBury: true, newSpread: 0, dueCounts: true, curModel: String(modelId), collapseTime: 1200 }),
      JSON.stringify({ [modelId]: model }),
      JSON.stringify({ [deckId]: deck }),
      JSON.stringify(dconf),
      JSON.stringify({}),
    ]);

    const baseId = Date.now();
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const noteId = baseId + i * 100;
      const cardId = noteId + 1;
      const flds = [makeFront(card.sentence, card.word), card.word, card.reading, card.meaning].join('\x1f');
      const csum = await fieldChecksum(card.sentence);
      const tagsStr = card.tags.length ? ' ' + card.tags.join(' ') + ' ' : '';
      db.run(`INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [noteId, makeGuid(), modelId, now, -1, tagsStr, flds, card.sentence, csum, 0, '']);
      db.run(`INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [cardId, noteId, deckId, 0, now, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, '']);
    }

    const dbBytes = db.export();
    const zip = new JSZip();
    zip.file('collection.anki2', dbBytes);
    zip.file('media', '{}');

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckName}.apkg`;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error(err);
    alert('Export failed: ' + err.message);
  }
}

// ── Anki .apkg Import ────────────────────────────────────

async function importApkg(file) {
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

    const SQL = await initSqlJs({
      locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`
    });

    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    const anki2 = zip.file('collection.anki2');
    if (!anki2) { alert(t('importApkgError')); return; }

    const dbBytes = await anki2.async('uint8array');
    const db = new SQL.Database(dbBytes);

    const colResult = db.exec('SELECT models FROM col LIMIT 1');
    if (!colResult.length || !colResult[0].values.length) { alert(t('importApkgError')); return; }

    const models = JSON.parse(colResult[0].values[0][0]);

    // Find a model with Sentence, Word, and Meaning fields (Reading optional)
    let targetMid = null;
    let sentIdx = -1, wordIdx = -1, readIdx = -1, meanIdx = -1;

    for (const [mid, model] of Object.entries(models)) {
      const flds = [...model.flds].sort((a, b) => a.ord - b.ord);
      const si = flds.findIndex(f => f.name.toLowerCase() === 'sentence');
      const wi = flds.findIndex(f => f.name.toLowerCase() === 'word');
      const ri = flds.findIndex(f => f.name.toLowerCase() === 'reading');
      const mi = flds.findIndex(f => f.name.toLowerCase() === 'meaning');
      if (si !== -1 && wi !== -1 && mi !== -1) {
        targetMid = mid;
        sentIdx = si; wordIdx = wi; readIdx = ri; meanIdx = mi;
        break;
      }
    }

    if (targetMid === null) { alert(t('importApkgIncompat')); return; }

    const notesResult = db.exec(`SELECT flds, tags FROM notes WHERE mid = ${targetMid}`);
    if (!notesResult.length || !notesResult[0].values.length) { alert(t('importApkgError')); return; }

    const stripHtml = s => (s || '').replace(/<[^>]+>/g, '').trim();

    const existingKeys = new Set(cards.map(c => `${c.sentence}|${c.word}`));
    let imported = 0, skipped = 0;

    for (const [flds, tagsRaw] of notesResult[0].values) {
      const fields = flds.split('\x1f');
      const sentence = stripHtml(fields[sentIdx]);
      const word = (fields[wordIdx] || '').trim();
      const reading = readIdx !== -1 ? (fields[readIdx] || '').trim() : '';
      const meaning = (fields[meanIdx] || '').trim();
      if (!sentence || !word) continue;

      const key = `${sentence}|${word}`;
      if (existingKeys.has(key)) { skipped++; continue; }

      const tags = tagsRaw ? tagsRaw.trim().split(/\s+/).filter(Boolean) : [];
      cards.push({ id: Date.now() + imported, sentence, word, reading, meaning, tags });
      existingKeys.add(key);
      imported++;
    }

    if (imported === 0 && skipped === 0) { alert(t('importApkgError')); return; }

    saveCards();
    updateAutocomplete();
    renderCardList();
    updateCardCountDisplay();
    const msg = t('importApkgSuccess');
    alert(typeof msg === 'function' ? msg(imported, skipped) : msg);

  } catch (err) {
    console.error(err);
    alert(t('importApkgError'));
  }
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
