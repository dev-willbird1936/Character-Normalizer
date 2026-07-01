import { describe, it, expect } from 'vitest';
import { buildNormalizationPrompt } from '../src/generation/prompt-builder.js';
import type { FormState } from '../src/generation/types.js';

function baseState(overrides: Partial<FormState> = {}): FormState {
  return {
    mode: 'front-generate',
    prompt: 'a young woman with blonde hair',
    outputs: { front: true, side: true, body: true },
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
    ...overrides,
  };
}

describe('buildNormalizationPrompt', () => {
  it('includes core constraints and lighting instructions', () => {
    const result = buildNormalizationPrompt(baseState());
    expect(result.prompt).toContain('Studio orthographic character reference sheet');
    expect(result.prompt).toContain('Neutral soft studio lighting');
    expect(result.prompt).toContain('clean solid background');
    expect(result.negativePrompt).toContain('multiple people');
    expect(result.negativePrompt).toContain('crop errors');
    expect(result.negativePrompt).toContain('deformed anatomy');
    expect(result.negativePrompt).toContain('background scene');
  });

  it('front-generate derives identity from the user prompt', () => {
    const result = buildNormalizationPrompt(baseState({ prompt: 'a young man with glasses' }));
    expect(result.prompt).toContain('Generate a new character from the description below');
    expect(result.prompt).toContain('a young man with glasses');
    expect(result.metadata.mode).toBe('front-generate');
  });

  it('front-generate does not inject body radios that were not selected in the UI', () => {
    const result = buildNormalizationPrompt(
      baseState({
        bodyOptions: { bodyShape: 'heavy', gender: 'male', physique: 'muscular' },
      })
    );

    expect(result.prompt).not.toContain('heavy body shape');
    expect(result.prompt).not.toContain('muscular physique');
  });

  it('front-modify preserves source identity and applies removals', () => {
    const result = buildNormalizationPrompt(
      baseState({
        mode: 'front-modify',
        sourceImagePath: '/tmp/face.png',
        cleanup: {
          enhanceImage: true,
          removeHair: true,
          removeBeard: true,
          removeEyebrow: false,
          removeEyelash: false,
          removeMakeup: false,
        },
      })
    );
    expect(result.prompt).toContain('source photo as the identity base');
    expect(result.prompt).toContain('Identity preservation is mandatory');
    expect(result.prompt).toContain('preserve the original person, facial geometry');
    expect(result.prompt).toContain('Preserve the original body shape, build, height-to-width proportions');
    expect(result.prompt).toContain('Do not beautify, age-shift, stylize, slim, bulk, or genericize');
    expect(result.prompt).toContain('Preserve age, ethnicity, facial structure, gaze, makeup');
    expect(result.prompt).toContain('enhanced clarity and detail');
    expect(result.prompt).toContain('no hair/bald');
    expect(result.prompt).toContain('no beard');
    expect(result.prompt).toContain('Selected cleanup options are mandatory for every requested view');
    expect(result.prompt).toContain('Do not reintroduce removed features in side or body outputs');
    expect(result.negativePrompt).toContain('hair');
    expect(result.negativePrompt).toContain('beard');
    expect(result.metadata.sourceImagePath).toBe('/tmp/face.png');
  });

  it('applies cleanup instructions to side and body output descriptions', () => {
    const result = buildNormalizationPrompt(
      baseState({
        mode: 'front-modify',
        sourceImagePath: '/tmp/face.png',
        cleanup: {
          enhanceImage: false,
          removeHair: true,
          removeBeard: false,
          removeEyebrow: false,
          removeEyelash: true,
          removeMakeup: true,
        },
      })
    );

    expect(result.prompt).toContain('true 90-degree side profile, same identity, matching source nose, lips, jaw, skull shape, neck, and facial proportions, no hair/bald, no eyelashes, no makeup');
    expect(result.prompt).toContain('full-body character reference, relaxed A/T-pose-like stance, preserving source body shape, build, height-to-width proportions, shoulder/waist/hip balance, limb proportions, and posture cues, no hair/bald, no eyelashes, no makeup');
  });

  it('side-body derives identity from source photo and reflects body options', () => {
    const result = buildNormalizationPrompt(
      baseState({
        mode: 'side-body',
        sourceImagePath: '/tmp/face.png',
        outputs: { front: false, side: false, body: true },
        bodyOptions: { bodyShape: 'heavy', gender: 'male', physique: 'muscular' },
      })
    );
    expect(result.prompt).toContain('Derive character identity from the provided source photo');
    expect(result.prompt).toContain('Identity preservation is mandatory');
    expect(result.prompt).toContain('heavy body shape');
    expect(result.prompt).toContain('explicit controlled adjustment while preserving source identity and distinctive build');
    expect(result.prompt).toContain('male');
    expect(result.prompt).toContain('muscular physique');
    expect(result.negativePrompt).not.toContain('full body');
  });

  it('adds drift prevention to the negative prompt', () => {
    const result = buildNormalizationPrompt(baseState());
    expect(result.negativePrompt).toContain('generic face');
    expect(result.negativePrompt).toContain('changed facial features');
    expect(result.negativePrompt).toContain('changed body shape');
    expect(result.negativePrompt).toContain('changed body proportions');
    expect(result.negativePrompt).toContain('unrequested slimming');
    expect(result.negativePrompt).toContain('unrequested bulking');
    expect(result.negativePrompt).toContain('beautified identity');
  });

  it('adds full-body to negative prompt when body output is not requested', () => {
    const result = buildNormalizationPrompt(baseState({ outputs: { front: true, side: true, body: false } }));
    expect(result.negativePrompt).toContain('full body');
  });

  it('negative prompt includes removal targets when selected', () => {
    const result = buildNormalizationPrompt(
      baseState({
        cleanup: {
          enhanceImage: false,
          removeHair: false,
          removeBeard: false,
          removeEyebrow: true,
          removeEyelash: true,
          removeMakeup: true,
        },
      })
    );
    expect(result.negativePrompt).toContain('eyebrows');
    expect(result.negativePrompt).toContain('eyelashes');
    expect(result.negativePrompt).toContain('makeup');
  });
});
