import { getStore } from '@netlify/blobs';

const store = getStore('darlington-shared-radio');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
const MAX_BYTES = 25 * 1024 * 1024;
const allowed = /\.(mp3|m4a|wav|ogg|aac|flac|opus)$/i;

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' } });
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.searchParams.has('id')) {
      const id = url.searchParams.get('id');
      const metadata = await store.getMetadata(id);
      if (!metadata) return json({ error: 'Song not found' }, 404);
      const blob = await store.get(id, { type: 'arrayBuffer' });
      if (!blob) return json({ error: 'Song not found' }, 404);
      return new Response(blob, { headers: { 'content-type': metadata.metadata?.type || 'audio/mpeg', 'content-length': String(blob.byteLength), 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'content-disposition': `inline; filename="${(metadata.metadata?.name || 'song.mp3').replace(/[\r\n"\\]/g, '_')}"` } });
    }
    if (request.method === 'GET') {
      const result = await store.list();
      const songs = [];
      for (const item of result.blobs || []) {
        const meta = item.metadata || (await store.getMetadata(item.key))?.metadata || {};
        songs.push({ id: item.key, name: meta.name || item.key, type: meta.type || 'audio/mpeg', size: meta.size || null, addedAt: meta.addedAt || null });
      }
      songs.sort((a,b) => (a.addedAt || 0) - (b.addedAt || 0));
      return json({ songs });
    }
    if (request.method === 'POST') {
      const expected = process.env.RADIO_ADMIN_TOKEN;
      const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!expected || !provided || provided !== expected) return json({ error: 'Upload authorization failed. Set the site owner’s RADIO_ADMIN_TOKEN in Netlify environment variables.' }, 401);
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return json({ error: 'Choose an audio file.' }, 400);
      if (!allowed.test(file.name) || !(file.type.startsWith('audio/') || allowed.test(file.name))) return json({ error: 'Unsupported audio format.' }, 415);
      if (file.size < 1 || file.size > MAX_BYTES) return json({ error: 'Each audio file must be smaller than 25 MB.' }, 413);
      const id = crypto.randomUUID();
      const name = file.name.replace(/[\r\n]/g, '').slice(0, 180);
      await store.set(id, await file.arrayBuffer(), { metadata: { name, type: file.type || 'audio/mpeg', size: file.size, addedAt: Date.now() } });
      return json({ ok: true, song: { id, name, type: file.type || 'audio/mpeg', size: file.size, addedAt: Date.now() } }, 201);
    }
    if (request.method === 'DELETE') {
      const expected = process.env.RADIO_ADMIN_TOKEN;
      const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!expected || !provided || provided !== expected) return json({ error: 'Upload authorization failed.' }, 401);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing song id.' }, 400);
      await store.delete(id);
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error(error);
    return json({ error: 'Shared radio storage error. Check the Netlify deployment and Blobs setup.' }, 500);
  }
};
