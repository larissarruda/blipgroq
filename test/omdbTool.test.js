import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GROQ_API_KEY ??= 'test-groq-key';
process.env.OMDB_API_KEY ??= 'test-omdb-key';
process.env.LOG_LEVEL ??= 'fatal';

const { omdbInputSchema, omdbToolDefinition } = await import('../src/omdbTool.js');

test('omdbInputSchema: exige title ou imdb_id', () => {
  const r = omdbInputSchema.safeParse({});
  assert.equal(r.success, false);
});

test('omdbInputSchema: aceita título válido', () => {
  const r = omdbInputSchema.safeParse({ title: 'The Matrix', year: 1999, type: 'movie' });
  assert.equal(r.success, true);
  assert.equal(r.data.plot, 'short');
});

test('omdbInputSchema: rejeita imdb_id inválido', () => {
  const r = omdbInputSchema.safeParse({ imdb_id: 'abc' });
  assert.equal(r.success, false);
});

test('omdbInputSchema: aceita imdb_id válido', () => {
  const r = omdbInputSchema.safeParse({ imdb_id: 'tt0133093' });
  assert.equal(r.success, true);
});

test('omdbToolDefinition: schema tem nome e descrição', () => {
  assert.equal(omdbToolDefinition.type, 'function');
  assert.equal(omdbToolDefinition.function.name, 'search_omdb');
  assert.ok(omdbToolDefinition.function.description.length > 30);
  assert.equal(omdbToolDefinition.function.parameters.type, 'object');
});
