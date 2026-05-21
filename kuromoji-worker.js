importScripts('https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js');

let tokenizer = null;

kuromoji
  .builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict' })
  .build((err, t) => {
    if (err) {
      postMessage({ type: 'error' });
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
