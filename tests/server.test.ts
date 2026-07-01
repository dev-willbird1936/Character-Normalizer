import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from '../src/server.js';
import type { GenerationRequest } from '../src/generation/types.js';

let server: Server;
let baseUrl: string;
let tmpDir: string;

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    mode: 'front-generate',
    prompt: 'normalized test character',
    negativePrompt: '',
    outputs: { front: true, side: true, body: false },
    resolution: '1024 (1024 px)',
    autoSavePath: path.join(tmpDir, 'generated'),
    cleanup: {
      enhanceImage: false,
      removeHair: false,
      removeBeard: false,
      removeEyebrow: false,
      removeEyelash: false,
      removeMakeup: false,
    },
    bodyOptions: {
      bodyShape: 'average',
      gender: 'female',
      physique: 'normal',
    },
    metadata: {},
    ...overrides,
  };
}

async function postJson(pathname: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.IMAGE_GENERATION_PROVIDER = 'mock';
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-generator-server-'));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not bind test server');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.IMAGE_GENERATION_PROVIDER;
});

describe('server API', () => {
  it('generates mock assets through the JSON endpoint', async () => {
    const response = await postJson('/api/generate', baseRequest());
    const data = await response.json() as {
      ok: boolean;
      result: { assets: Array<{ output: string; filePath: string }> };
    };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.result.assets.map((asset) => asset.output)).toEqual(['front', 'side']);

    for (const asset of data.result.assets) {
      await expect(fs.stat(asset.filePath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    }
  });

  it('streams prompt, per-asset events, then complete', async () => {
    const response = await postJson('/api/generate?stream=1', baseRequest({
      outputs: { front: true, side: true, body: true },
      autoSavePath: path.join(tmpDir, 'streamed'),
    }));
    const text = await response.text();
    const events = text.trim().split('\n').map((line) => JSON.parse(line) as { type: string; asset?: { output: string } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(events.map((event) => event.type)).toEqual(['prompt', 'asset', 'asset', 'asset', 'complete']);
    expect(events.filter((event) => event.type === 'asset').map((event) => event.asset?.output)).toEqual(['front', 'side', 'body']);
  });

  it('uploads base64 image data and serves it through /api/image', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>';
    const upload = await postJson('/api/upload', {
      filename: 'bad name.svg',
      data: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    });
    const uploadData = await upload.json() as { ok: boolean; filePath: string };

    expect(upload.status).toBe(200);
    expect(uploadData.ok).toBe(true);
    expect(path.basename(uploadData.filePath)).toMatch(/bad_name\.svg$/);
    await expect(fs.readFile(uploadData.filePath, 'utf8')).resolves.toBe(svg);

    const image = await fetch(`${baseUrl}/api/image?path=${encodeURIComponent(uploadData.filePath)}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/svg+xml');
    expect(await image.text()).toBe(svg);
  });

  it('applies only selected assets and preserves image extension', async () => {
    const sourceDir = path.join(tmpDir, 'apply-source');
    const targetDir = path.join(tmpDir, 'apply-target');
    await fs.mkdir(sourceDir, { recursive: true });
    const front = path.join(sourceDir, 'front.svg');
    const side = path.join(sourceDir, 'side.svg');
    await fs.writeFile(front, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await fs.writeFile(side, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const response = await postJson('/api/apply', {
      assets: [
        { output: 'front', filePath: front },
        { output: 'side', filePath: side },
      ],
      outputs: { front: true, side: false, body: true },
      autoSavePath: targetDir,
    });
    const data = await response.json() as { ok: boolean; applied: Array<{ output: string; filePath: string }> };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.applied).toHaveLength(1);
    expect(data.applied[0].output).toBe('front');
    expect(data.applied[0].filePath).toMatch(/final_front_\d+\.svg$/);
    await expect(fs.stat(data.applied[0].filePath)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });
});
