import { MAX_BODY_BYTES, isFileName, isMediaType } from '../../shared/body.ts';
import { requestFiles } from './workspace.ts';
import type { Draft, FileReference } from './workspace.ts';

const sessionFiles = new Map<string, Blob>();
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('File storage is unavailable.')); return; }
    const request = indexedDB.open('reqora.attachments', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error || new Error('Unable to open file storage.'));
    request.onblocked = () => reject(new Error('File storage is blocked by another window.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}

export async function storeAttachment(file: File): Promise<{ reference: FileReference; temporary: boolean }> {
  if (file.size > MAX_BODY_BYTES) throw new Error('Files must be 10 MB or smaller.');
  if (!isFileName(file.name)) throw new Error('Use a file name without slashes or line breaks (up to 255 characters).');
  const reference = { id: crypto.randomUUID(), name: file.name, size: file.size, type: isMediaType(file.type) ? file.type : 'application/octet-stream' };
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').put(file, reference.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Unable to store file.'));
    });
    return { reference, temporary: false };
  } catch {
    sessionFiles.set(reference.id, file);
    return { reference, temporary: true };
  }
}

export async function getAttachment(reference: FileReference): Promise<Blob | undefined> {
  const inSession = sessionFiles.get(reference.id);
  if (inSession) return inSession.size === reference.size ? inSession : undefined;
  try {
    const db = await openDatabase();
    const file = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('files', 'readonly').objectStore('files').get(reference.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return file instanceof Blob && file.size === reference.size ? file : undefined;
  } catch { return undefined; }
}

export async function readRequestFiles(request: Draft, signal?: AbortSignal): Promise<Map<string, string>> {
  const references = requestFiles(request);
  if (references.reduce((total, file) => total + file.size, 0) > MAX_BODY_BYTES) throw new Error('Combined files exceed the 10 MB request body limit.');
  const result = new Map<string, string>();
  for (const reference of references) {
    signal?.throwIfAborted();
    if (result.has(reference.id)) continue;
    const file = await getAttachment(reference);
    if (!file) throw new Error(`Reattach “${reference.name}” before sending. Its file is unavailable on this device.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    result.set(reference.id, btoa(chunks.join('')));
    signal?.throwIfAborted();
  }
  return result;
}
