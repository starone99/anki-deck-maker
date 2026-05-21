try {
  importScripts('https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js');
} catch (e) {
  try {
    importScripts('https://unpkg.com/kuromoji@0.1.2/build/kuromoji.js');
  } catch (e2) {
    postMessage({ type: 'error', message: 'Failed to load kuromoji: ' + e2.message });
  }
}

let tokenizer = null;

kuromoji
  .builder({ dicPath: './dict' })
  .build((err, t) => {
    if (err) {
      postMessage({ type: 'error', message: err.message || String(err) });
      return;
    }
    tokenizer = t;
    postMessage({ type: 'ready' });
  });

self.addEventListener('message', (e) => {
  if (e.data.type !== 'tokenize' || !tokenizer) return;
  const tokens = tokenizer.tokenize(e.data.sentence);
  postMessage({ type: 'tokens', tokens, id: e.data.id });
});
