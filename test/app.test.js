import test from 'node:test';
import assert from 'node:assert/strict';

// Variáveis mínimas para carregar config sem sair
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'x'.repeat(20);
process.env.OMDB_API_KEY = process.env.OMDB_API_KEY || 'xxxx';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const app = createApp();

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /health responde 200', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'ok');
  server.close();
});

test('POST /agent sem body responde 400', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'invalid_body');
  server.close();
});

test('POST /agent com message muito grande responde 400', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'a'.repeat(3000) }),
  });
  assert.equal(res.status, 400);
  server.close();
});

test('Rota desconhecida responde 404', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/naoexiste`);
  assert.equal(res.status, 404);
  server.close();
});
