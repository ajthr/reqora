import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { getAttachment, readRequestFiles, storeAttachment } from '../src/lib/attachments.ts';
import { newDraft } from '../src/lib/workspace.ts';

test('fallback file storage retains exact bytes for the session and reports missing files', async () => {
  const bytes = new Uint8Array([0, 255, 128, 13, 10]);
  const stored = await storeAttachment(new File([bytes], 'payload.bin', { type: 'application/octet-stream' }));
  assert.equal(stored.temporary, true);
  assert.deepEqual(new Uint8Array(await (await getAttachment(stored.reference)).arrayBuffer()), bytes);
  const draft = { ...newDraft(), method: 'PUT', bodyType: 'binary', binaryFile: stored.reference };
  assert.equal((await readRequestFiles(draft)).get(stored.reference.id), Buffer.from(bytes).toString('base64'));
  await assert.rejects(readRequestFiles({ ...draft, binaryFile: { ...stored.reference, id: 'missing' } }), /Reattach/);
  assert.equal((await readRequestFiles({ ...draft, method: 'GET' })).size, 0);
  await assert.rejects(readRequestFiles(draft, AbortSignal.abort()), { name: 'AbortError' });
});

test('IndexedDB attachments survive a fresh store instance and keep bytes outside workspace JSON', async () => {
  globalThis.indexedDB = new IDBFactory();
  const file = new File([new Uint8Array([0, 255, 128]), '{{literal}}'], 'résumé.bin', { type: 'application/octet-stream' });
  const stored = await storeAttachment(file);
  assert.equal(stored.temporary, false);
  assert(!JSON.stringify(stored.reference).includes('data'));
  const fresh = await import('../src/lib/attachments.ts?fresh-store');
  const persisted = await fresh.getAttachment(stored.reference);
  assert.deepEqual(Buffer.from(await persisted.arrayBuffer()), Buffer.from(await file.arrayBuffer()));
  const draft = { ...newDraft(), method: 'POST', bodyType: 'multipart', multipartFields: [
    { id: 'one', name: 'files', value: '', enabled: true, kind: 'file', file: stored.reference },
    { id: 'two', name: 'files', value: '', enabled: true, kind: 'file', file: stored.reference },
  ] };
  assert.equal((await fresh.readRequestFiles(draft)).size, 1);
  assert.equal(await fresh.getAttachment({ ...stored.reference, size: 0 }), undefined);
  await assert.rejects(storeAttachment(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.bin')), /10 MB/);
  await assert.rejects(storeAttachment(new File(['bytes'], '../invalid')), /file name/);
});
