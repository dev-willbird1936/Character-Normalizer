import { describe, it, expect } from 'vitest';
import {
  CodexCliImageProvider,
  defaultCodexArgs,
  defaultCodexStdin,
  defaultParseOutput,
  resolveWindowsExecutable,
  sanitizeProviderOutput,
} from '../src/generation/codex-cli-provider.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GenerationRequest } from '../src/generation/types.js';

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    mode: 'front-generate',
    prompt: 'a woman',
    negativePrompt: 'bad anatomy',
    outputs: { front: true, side: true, body: false },
    resolution: '4K (4096 px)',
    autoSavePath: '/tmp/out',
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

describe('defaultCodexArgs', () => {
  it('builds codex exec args and reads prompt from stdin', () => {
    const args = defaultCodexArgs(baseRequest(), 'front');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ignore-rules');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).toContain('--output-last-message');
    expect(args.at(-1)).toBe('-');
    expect(args).not.toContain('image');
    expect(args).not.toContain('generate');
  });

  it('attaches source image when present', () => {
    const args = defaultCodexArgs(baseRequest({ sourceImagePath: '/tmp/photo.jpg' }), 'front');
    expect(args).toContain('--image');
    expect(args).toContain('/tmp/photo.jpg');
  });

  it('does not attach image flag when no source image is provided', () => {
    const args = defaultCodexArgs(baseRequest(), 'front');
    expect(args).not.toContain('--image');
  });
});

describe('defaultCodexStdin', () => {
  it('asks Codex to use imagegen and return JSON with the expected output asset', () => {
    const stdin = defaultCodexStdin(baseRequest(), 'front', '/tmp/out');
    expect(stdin).toContain('$imagegen');
    expect(stdin).toContain('generate a new image from prompt');
    expect(stdin).toContain('Provider prompt: a woman');
    expect(stdin).toContain('Negative prompt: bad anatomy');
    expect(stdin).toContain('"output":"front"');
    expect(stdin).toContain(path.join('/tmp/out'));
  });

  it('tells Codex to edit the attached image when a source image is present', () => {
    const stdin = defaultCodexStdin(baseRequest({ sourceImagePath: '/tmp/source.png' }), 'front', '/tmp/out');
    expect(stdin).toContain('edit attached source image');
  });
});

describe('defaultParseOutput', () => {
  it('parses JSON with assets and returns single output asset', () => {
    const stdout = JSON.stringify({
      assets: [{ output: 'front', filePath: '/tmp/front.png' }],
      metadata: { seed: 42 },
    });
    const result = defaultParseOutput(stdout, baseRequest(), 'front');
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].output).toBe('front');
    expect(result.assets[0].filePath).toBe('/tmp/front.png');
    expect(result.metadata.seed).toBe(42);
  });

  it('parses JSON with files array', () => {
    const stdout = JSON.stringify({
      files: [{ path: '/tmp/front.png' }],
    });
    const result = defaultParseOutput(stdout, baseRequest(), 'front');
    expect(result.assets[0].output).toBe('front');
    expect(result.assets[0].filePath).toBe('/tmp/front.png');
  });

  it('parses JSON when provider wraps it with progress text', () => {
    const stdout = 'working...\n{"assets":[{"output":"front","filePath":"/tmp/front.png"}],"metadata":{"ok":true}}\ndone';
    const result = defaultParseOutput(stdout, baseRequest(), 'front');
    expect(result.assets[0]).toEqual({ output: 'front', filePath: '/tmp/front.png' });
    expect(result.metadata.ok).toBe(true);
  });

  it('parses single line output into asset', () => {
    const stdout = '/tmp/front.png';
    const result = defaultParseOutput(stdout, baseRequest(), 'front');
    expect(result.assets[0]).toEqual({ output: 'front', filePath: '/tmp/front.png' });
  });

  it('throws on empty output', () => {
    expect(() => defaultParseOutput('', baseRequest(), 'front')).toThrow('Provider produced no output');
  });
});

describe('sanitizeProviderOutput', () => {
  it('redacts configured env secrets and common auth fields', () => {
    const exampleBearer = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    const result = sanitizeProviderOutput(
      `Authorization: Bearer ${exampleBearer} and OPENAI_API_KEY=super-secret-value`,
      {
        OPENAI_API_KEY: 'super-secret-value',
      }
    );

    expect(result).toContain('[redacted]');
    expect(result).not.toContain('super-secret-value');
    expect(result).not.toContain(exampleBearer);
  });
});

describe('resolveWindowsExecutable', () => {
  it('wraps Windows cmd shims through cmd.exe', () => {
    const resolved = resolveWindowsExecutable('C:\\Tools\\codex.cmd', {});

    if (process.platform === 'win32') {
      expect(resolved.command.toLowerCase()).toContain('cmd');
      expect(resolved.args).toContain('/c');
      expect(resolved.args.at(-1)).toContain('"C:\\Tools\\codex.cmd"');
    } else {
      expect(resolved.command).toBe('C:\\Tools\\codex.cmd');
      expect(resolved.args).toEqual([]);
    }
  });
});

describe('CodexCliImageProvider', () => {
  it('runs a custom command and parses its output per active output', async () => {
    const provider = new CodexCliImageProvider({
      command: 'node',
      getArgs: (_req, output) => [
        '-e',
        `console.log(JSON.stringify({assets:[{output:'${output}',filePath:'/tmp/${output}.png'}],metadata:{}}))`,
      ],
    });

    const result = await provider.generate(
      baseRequest({ outputs: { front: true, side: true, body: false } })
    );
    expect(result.assets).toHaveLength(2);
    expect(result.assets.map((a) => a.filePath).sort()).toEqual(['/tmp/front.png', '/tmp/side.png']);
  });

  it('reports each parsed asset through the progress callback', async () => {
    const provider = new CodexCliImageProvider({
      command: 'node',
      getArgs: (_req, output) => [
        '-e',
        `console.log(JSON.stringify({assets:[{output:'${output}',filePath:'/tmp/${output}.png'}],metadata:{}}))`,
      ],
    });
    const progressAssets: string[] = [];

    const result = await provider.generate(
      baseRequest({ outputs: { front: true, side: true, body: false } }),
      {
        onAsset: (asset) => {
          progressAssets.push(asset.filePath);
        },
      }
    );

    expect(progressAssets).toEqual(result.assets.map((asset) => asset.filePath));
  });

  it('runs a Windows .cmd provider shim when command points at one', async () => {
    if (process.platform !== 'win32') return;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-provider-'));
    const shim = path.join(dir, 'mock-provider.cmd');
    await fs.writeFile(
      shim,
      '@echo off\r\nnode -e "console.log(JSON.stringify({assets:[{output:process.argv[1],filePath:\'/tmp/\'+process.argv[1]+\'.png\'}],metadata:{}}))" %*\r\n'
    );

    const provider = new CodexCliImageProvider({
      command: shim,
      getArgs: (_req, output) => [output],
    });

    const result = await provider.generate(
      baseRequest({ outputs: { front: true, side: false, body: false } })
    );

    expect(result.assets[0]).toEqual({ output: 'front', filePath: '/tmp/front.png' });
  });

  it('surfaces exit-code errors without exposing env secrets', async () => {
    const provider = new CodexCliImageProvider({
      command: 'node',
      env: { OPENAI_API_KEY: 'super-secret-value' },
      getArgs: () => ['-e', 'console.error(process.env.OPENAI_API_KEY); process.exit(1)'],
    });

    let thrown: Error | undefined;
    try {
      await provider.generate(baseRequest());
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown?.message).toContain('Provider exited with code 1. [redacted]');
    expect(thrown?.message).not.toContain('super-secret-value');
  });
});
