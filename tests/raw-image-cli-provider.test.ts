import { describe, it, expect } from 'vitest';
import {
  buildRawImageCliArgs,
  buildRawImagePrompt,
  mapResolutionToImageSize,
} from '../src/generation/raw-image-cli-provider.js';
import type { GenerationRequest } from '../src/generation/types.js';

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    mode: 'front-generate',
    prompt: 'normalized front portrait',
    negativePrompt: 'watermark, text',
    outputs: { front: true, side: false, body: false },
    resolution: '4K (4096 px)',
    autoSavePath: 'output',
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

describe('mapResolutionToImageSize', () => {
  it('maps UI resolution labels to GPT Image compatible square sizes', () => {
    expect(mapResolutionToImageSize('1024 (1024 px)')).toBe('1024x1024');
    expect(mapResolutionToImageSize('2K (2048 px)')).toBe('2048x2048');
    expect(mapResolutionToImageSize('4K (4096 px)')).toBe('2880x2880');
    expect(mapResolutionToImageSize('8K (8192 px)')).toBe('2880x2880');
  });
});

describe('buildRawImageCliArgs', () => {
  it('builds direct generate args without Codex CLI or MCPs', () => {
    const args = buildRawImageCliArgs({
      scriptPath: 'image_gen.py',
      request: baseRequest(),
      output: 'front',
      promptFile: 'prompt.txt',
      outPath: 'front.png',
      size: '2880x2880',
      quality: 'medium',
      model: 'gpt-image-2',
    });

    expect(args[0]).toBe('image_gen.py');
    expect(args[1]).toBe('generate');
    expect(args).toContain('--prompt-file');
    expect(args).toContain('prompt.txt');
    expect(args).toContain('--out');
    expect(args).toContain('front.png');
    expect(args).toContain('--no-augment');
    expect(args).not.toContain('codex');
    expect(args).not.toContain('--image');
  });

  it('builds direct edit args when source image is present', () => {
    const args = buildRawImageCliArgs({
      scriptPath: 'image_gen.py',
      request: baseRequest({ sourceImagePath: 'source.png' }),
      output: 'front',
      promptFile: 'prompt.txt',
      outPath: 'front.png',
      size: '1024x1024',
      quality: 'low',
      model: 'gpt-image-2',
    });

    expect(args[1]).toBe('edit');
    expect(args).toContain('--image');
    expect(args).toContain('source.png');
  });
});

describe('buildRawImagePrompt', () => {
  it('keeps negative prompt in the prompt file', () => {
    const prompt = buildRawImagePrompt(baseRequest());
    expect(prompt).toContain('normalized front portrait');
    expect(prompt).toContain('Avoid: watermark, text');
  });
});
