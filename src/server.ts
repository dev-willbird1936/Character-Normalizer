import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDefaultRegistry, ProviderRegistry } from './generation/provider-registry.js';
import { buildNormalizationPrompt } from './generation/prompt-builder.js';
import type { GeneratedAsset, GenerationRequest, GenerationResult, OutputName } from './generation/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.use(express.json({ limit: '50mb' }));

export const registry: ProviderRegistry = createDefaultRegistry();
let generateRequestSeq = 0;

app.post('/api/generate', async (req, res) => {
  const requestId = ++generateRequestSeq;
  const startedAt = Date.now();
  try {
    const prepared = prepareGenerationRequest(req.body as Partial<GenerationRequest>);
    if (!prepared.ok) {
      res.status(400).json({ ok: false, error: 'Missing required generation fields' });
      return;
    }

    const { body, promptBundle, request, outputs } = prepared;
    console.log(
      `[generate:${requestId}] received mode=${body.mode} outputs=${outputs || 'none'} resolution="${body.resolution}" sourceImage=${body.sourceImagePath ? 'yes' : 'no'} provider="${process.env.IMAGE_GENERATION_PROVIDER || 'codex-cli'}"`
    );

    if (req.query.stream === '1') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      writeStreamEvent(res, { type: 'prompt', prompt: promptBundle });

      try {
        const result = await registry.getDefault().generate(request, {
          onAsset: (asset) => writeStreamEvent(res, { type: 'asset', asset }),
        });
        console.log(
          `[generate:${requestId}] success assets=${result.assets.length} duration=${formatDuration(startedAt)}`
        );
        writeStreamEvent(res, { type: 'complete', result, prompt: promptBundle });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generation failed';
        console.error(`[generate:${requestId}] failed duration=${formatDuration(startedAt)} ${message}`);
        writeStreamEvent(res, { type: 'error', error: message });
      } finally {
        res.end();
      }
      return;
    }

    const result: GenerationResult = await registry.getDefault().generate(request);
    console.log(
      `[generate:${requestId}] success assets=${result.assets.length} duration=${formatDuration(startedAt)}`
    );
    res.json({ ok: true, result, prompt: promptBundle });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    console.error(`[generate:${requestId}] failed duration=${formatDuration(startedAt)} ${message}`);
    res.status(500).json({ ok: false, error: message });
  }
});

function prepareGenerationRequest(body: Partial<GenerationRequest>):
  | { ok: true; body: Partial<GenerationRequest>; promptBundle: ReturnType<typeof buildNormalizationPrompt>; request: GenerationRequest; outputs: string }
  | { ok: false } {
  if (
    !body.mode ||
    !body.outputs ||
    !body.resolution ||
    body.autoSavePath === undefined
  ) {
    return { ok: false };
  }

  const outputs = Object.entries(body.outputs)
      .filter(([, enabled]) => enabled)
      .map(([output]) => output)
      .join(',');

  const promptBundle = buildNormalizationPrompt(body as GenerationRequest);
  const request: GenerationRequest = {
    ...(body as GenerationRequest),
    ...promptBundle,
  };

  return { ok: true, body, promptBundle, request, outputs };
}

function writeStreamEvent(res: express.Response, event: Record<string, unknown>): void {
  res.write(`${JSON.stringify(event)}\n`);
}

app.post('/api/upload', async (req, res) => {
  try {
    const { filename, data } = req.body as { filename?: string; data?: string };
    if (!filename || !data) {
      res.status(400).json({ ok: false, error: 'Missing filename or data' });
      return;
    }

    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(uploadsDir, `${Date.now()}_${safeName}`);
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'));

    res.json({ ok: true, filePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post('/api/apply', async (req, res) => {
  try {
    const { assets, outputs, autoSavePath } = req.body as {
      assets?: GeneratedAsset[];
      outputs?: Record<OutputName, boolean>;
      autoSavePath?: string;
    };

    if (!Array.isArray(assets) || !outputs || !autoSavePath) {
      res.status(400).json({ ok: false, error: 'Missing assets, outputs, or autoSavePath' });
      return;
    }

    const outDir = path.resolve(autoSavePath);
    await fs.mkdir(outDir, { recursive: true });
    const timestamp = Date.now();
    const applied: GeneratedAsset[] = [];

    for (const asset of assets) {
      if (!outputs[asset.output]) continue;
      const ext = normalizedImageExt(asset.filePath);
      const target = path.join(outDir, `final_${asset.output}_${timestamp}${ext}`);
      await fs.copyFile(asset.filePath, target);
      applied.push({ output: asset.output, filePath: target });
    }

    console.log(`[apply] copied ${applied.length} asset(s) to "${outDir}"`);
    res.json({ ok: true, applied });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message || 'Apply failed' });
  }
});

app.get('/api/image', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).send('missing path');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
    };
    const contentType = contentTypes[ext];
    if (!contentType) {
      res.status(415).send('unsupported image type');
      return;
    }

    const data = await fs.readFile(filePath);

    res.setHeader('Content-Type', contentType);
    res.send(data);
  } catch {
    res.status(404).send('image not found');
  }
});

app.use(express.static(path.join(__dirname, '../public')));

export function startServer(port: string | number = process.env.PORT || 3000): void {
  app.listen(port, () => {
    console.log(`Character Normalizer server running at http://localhost:${port}`);
  });
}

if (isMainModule()) {
  startServer();
}

function formatDuration(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function normalizedImageExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext) ? ext : '.png';
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
}
