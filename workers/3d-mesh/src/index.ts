import { Hono } from 'hono';

// The cast as geometry: one mesh per piece, generated once and kept forever.
// ... (comments from original)

const R2_PREFIX = 'cast';
const MESH_VERSION = 1;
const FACE_LIMIT = 30000;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ASSET_KEY = /^[a-z0-9-]{1,32}:0x[a-fA-F0-9]{40}:[A-Za-z0-9_-]{1,96}$/;

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const meshRecordKey = (assetKey: string) => `castmesh:v${MESH_VERSION}:${assetKey}`;
export const meshR2Key = (assetKey: string) => `${R2_PREFIX}/${assetKey}/v${MESH_VERSION}/mesh.glb`;

export const meshDisposition = (dossier: any) => {
  const medium = dossier?.medium ?? null;
  if (!medium) {
    return { known: false, reason: 'This piece has no dossier yet, so nothing is known about what it is.' };
  }
  const inference = ({ '3d-render': 'low', photoreal: 'low', 'trading-card': 'high' } as any)[medium] ?? 'high';
  return {
    known: true,
    medium,
    representation: 'blocking-proxy',
    inference,
    caveat:
      medium === 'trading-card'
        ? 'The artwork is a card, so a reconstruction models the card rather than the subject on it. Measured: it comes back as a paper-thin standee. Where the token carries a film showing the subject itself, that is the better source.'
        : null,
    reason: null,
  };
};

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

export class TripoError extends Error {
  code: number;
  outOfCredit: boolean;
  constructor(code: number, message: string) {
    super(`Tripo ${code}: ${message}`);
    this.name = 'TripoError';
    this.code = code;
    this.outOfCredit = code === 2010;
  }
}

const requireKey = (env: any) => {
  const key = env.TRIPO3D_API_KEY;
  if (!key) {
    throw new Error(
      'TRIPO3D_API_KEY is not set. Locally it goes in .env (scripts read it there) AND .dev.vars ' +
        '(so `wrangler dev` can see it); in production use `wrangler secret put TRIPO3D_API_KEY`.',
    );
  }
  return key;
};

const tripoJson = async (promise: Promise<Response>) => {
  const response = await promise;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new TripoError(0, `expected JSON, got ${contentType || 'nothing'} (HTTP ${response.status})`);
  }
  return response.json();
};

const startMeshTask = async (env: any, imageBytes: ArrayBuffer) => {
  const headers = { Authorization: `Bearer ${requireKey(env)}` };

  const form = new FormData();
  form.append('file', new Blob([imageBytes], { type: 'image/png' }), 'input.png');
  const uploaded: any = await tripoJson(fetch(`${TRIPO_BASE}/upload`, { method: 'POST', headers, body: form }));
  if (uploaded.code !== 0) throw new TripoError(uploaded.code, uploaded.message ?? 'upload failed');

  const created: any = await tripoJson(
    fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: 'png', file_token: uploaded.data?.image_token },
        texture: true,
        face_limit: FACE_LIMIT,
      }),
    }),
  );
  if (created.code !== 0) throw new TripoError(created.code, created.message ?? 'task rejected');
  return created.data?.task_id;
};

export const pollMeshTask = async (env: any, taskId: string) => {
  const headers = { Authorization: `Bearer ${requireKey(env)}` };
  const polled: any = await tripoJson(fetch(`${TRIPO_BASE}/task/${taskId}`, { headers }));
  const task = polled.data ?? {};
  return {
    status: task.status ?? 'unknown',
    progress: task.progress ?? 0,
    modelUrl: task.output?.pbr_model || task.output?.model || null,
  };
};

const dossierFor = async (env: any, assetKey: string, version: number) =>
  env.DOSSIERS ? env.DOSSIERS.get(`dossier:v${version}:${assetKey}`, 'json') : null;

// inline artwork fetch to avoid dependencies across packages
const fetchArtworkBytes = async (dossier: any) => {
  const urls = dossier.sourceImageUrls || [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      // arbitrary max size limit 10MB
      if (buffer.byteLength > 10 * 1024 * 1024) continue;
      return buffer;
    } catch (e) {
      continue;
    }
  }
  throw new Error("Could not fetch artwork from any provided URL.");
};

const putRecord = async (env: any, assetKey: string, record: any) => {
  await env.DOSSIERS?.put(meshRecordKey(assetKey), JSON.stringify(record));
  return record;
};

export const requestMesh = async (env: any, assetKey: string, { dossierVersion = 5, force = false } = {}) => {
  const existing = normalise(await env.DOSSIERS?.get(meshRecordKey(assetKey), 'json'));
  const stale = existing && existing.status === 'ready' && !existing.representation;
  if (existing && !force && !stale && !['failed', 'absent'].includes(existing.status)) {
    return { ...existing, cached: true };
  }

  const dossier = await dossierFor(env, assetKey, dossierVersion);
  const disposition = meshDisposition(dossier);
  const base = { assetKey, meshVersion: MESH_VERSION, medium: disposition.medium ?? null, createdAt: Date.now() };

  if (!disposition.known) {
    return { ...(await putRecord(env, assetKey, { ...base, status: 'unknown', reason: disposition.reason, r2Key: null })), cached: false };
  }

  const bytes = await fetchArtworkBytes(dossier);
  const taskId = await startMeshTask(env, bytes);

  return {
    ...(await putRecord(env, assetKey, {
      ...base,
      status: 'pending',
      representation: disposition.representation,
      inference: disposition.inference,
      caveat: disposition.caveat,
      reason: null,
      taskId,
      r2Key: null,
      faceLimit: FACE_LIMIT,
      sourceUrl: dossier?.sourceImageUrls?.[0] ?? null,
      model: 'tripo3d/image_to_model',
    })),
    cached: false,
  };
};

export const collectMesh = async (env: any, assetKey: string) => {
  const record = await env.DOSSIERS?.get(meshRecordKey(assetKey), 'json');
  if (!record || record.status !== 'pending') return record ?? null;

  let task;
  try {
    task = await pollMeshTask(env, record.taskId);
  } catch (error: any) {
    return { ...record, pollError: error.message };
  }

  if (['failed', 'banned', 'expired', 'cancelled'].includes(task.status)) {
    return putRecord(env, assetKey, { ...record, status: 'failed', reason: `The generation ended as ${task.status}.` });
  }
  if (task.status !== 'success' || !task.modelUrl) {
    return { ...record, progress: task.progress };
  }

  const glb = new Uint8Array(await (await fetch(task.modelUrl)).arrayBuffer());
  const r2Key = meshR2Key(assetKey);
  await env.STORYBOARD_IMAGES?.put(r2Key, glb, {
    httpMetadata: { contentType: 'model/gltf-binary' },
    customMetadata: { assetKey, sourceUrl: record.sourceUrl ?? '', taskId: record.taskId },
  });

  return putRecord(env, assetKey, { ...record, status: 'ready', r2Key, bytes: glb.byteLength, readyAt: Date.now() });
};

const normalise = (record: any) => {
  if (!record) return record;
  if (record.status === 'ineligible' || record.meshEligible === false) {
    return { ...record, status: 'absent', supersededGate: true };
  }
  if (record.status) return record;
  if (record.r2Key) return { ...record, status: 'ready' };
  return { ...record, status: 'absent' };
};

export async function handleCastMesh(request: Request, env: any) {
  const { searchParams } = new URL(request.url);
  const assetKey = searchParams.get('asset');
  if (!assetKey || !ASSET_KEY.test(assetKey)) {
    return json({ error: 'asset must be a chain:address:tokenId key' }, 400);
  }

  const record = normalise(await collectMesh(env, assetKey));
  if (!record) return json({ status: 'absent', assetKey }, 404);

  if (record.status === 'unknown') {
    return json({ status: 'unknown', assetKey, reason: record.reason });
  }
  if (record.status === 'pending') {
    return json({ status: 'pending', assetKey, progress: record.progress ?? 0, taskId: record.taskId });
  }
  if (record.status === 'failed') return json({ status: 'failed', assetKey, reason: record.reason }, 502);

  const object = await env.STORYBOARD_IMAGES?.get(record.r2Key);
  if (!object) return json({ status: 'absent', assetKey }, 404);

  return new Response(object.body, {
    headers: {
      'content-type': 'model/gltf-binary',
      'cache-control': CACHE_CONTROL,
      'access-control-allow-origin': '*',
      'x-source-url': record.sourceUrl ?? '',
      'x-mesh-bytes': String(record.bytes ?? 0),
      'x-representation': record.representation ?? 'blocking-proxy',
      'x-inference': record.inference ?? 'unknown',
    },
  });
}

export async function handleCastMeshGenerate(request: Request, env: any) {
  const body: any = await request.json().catch(() => ({}));
  const { asset, force = false } = body;
  if (!asset || !ASSET_KEY.test(asset)) return json({ error: 'Body needs { asset }' }, 400);
  try {
    return json(await requestMesh(env, asset, { force }));
  } catch (error: any) {
    return json({ error: error.message, outOfCredit: Boolean(error.outOfCredit) }, error.outOfCredit ? 402 : 500);
  }
}

// Setup Hono app
const app = new Hono();

app.get('/', (c) => c.text('3d-mesh worker is up and running!'));
app.get('/test', (c) => c.text('3d-mesh worker is up and running!'));

app.get('/mesh', async (c) => handleCastMesh(c.req.raw, c.env));
app.post('/mesh/generate', async (c) => handleCastMeshGenerate(c.req.raw, c.env));

export default app;
