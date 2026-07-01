import type { FormState, NormalizationPrompt, OutputName, CleanupOptions, BodyOptions } from './types.js';

export function buildNormalizationPrompt(state: FormState): NormalizationPrompt {
  return buildPromptForOutputs(state, state.outputs);
}

export function buildOutputPrompt(state: FormState, output: OutputName): NormalizationPrompt {
  const singleOutputs: Record<OutputName, boolean> = { front: false, side: false, body: false };
  singleOutputs[output] = true;
  return buildPromptForOutputs(state, singleOutputs);
}

function buildPromptForOutputs(
  state: FormState,
  activeOutputsMap: Record<OutputName, boolean>
): NormalizationPrompt {
  const {
    mode,
    prompt: userPrompt,
    sourceImagePath,
    resolution,
    cleanup,
    bodyOptions,
  } = state;

  const parts: string[] = [
    'Studio orthographic character reference sheet.',
    'Neutral soft studio lighting, clean solid background, centered subject.',
    'Consistent identity across all requested views. No stylization drift. No extra accessories unless explicitly requested.',
  ];

  if (mode === 'front-generate') {
    parts.push('Generate a new character from the description below.');
    parts.push(`Character description: ${userPrompt.trim() || 'unspecified human character'}.`);
  } else if (mode === 'front-modify') {
    parts.push('Use the provided source photo as the identity base.');
    parts.push(sourcePreservationText());
    parts.push('Preserve age, ethnicity, facial structure, gaze, makeup, and expression unless a selected cleanup option explicitly requires a change.');
    parts.push('Apply only the selected modifications.');
  } else if (mode === 'side-body') {
    parts.push('Derive character identity from the provided source photo.');
    parts.push(sourcePreservationText());
    parts.push('Generate only the requested orthographic output views.');
  }

  const globalCleanup = globalCleanupText(cleanup);
  if (globalCleanup) {
    parts.push(globalCleanup);
  }

  const activeOutputs = (Object.keys(activeOutputsMap) as OutputName[]).filter((o) => activeOutputsMap[o]);
  const outputDescriptions = activeOutputs.map((output) => (
    describeOutput(output, cleanup, bodyOptions, mode === 'side-body')
  ));
  if (outputDescriptions.length > 0) {
    parts.push(`Requested output: ${outputDescriptions.join('; ')}.`);
  }

  parts.push(`Output resolution: ${resolution}.`);

  const metadata: Record<string, unknown> = {
    mode,
    outputs: activeOutputsMap,
    resolution,
    cleanup,
    bodyOptions,
  };
  if (sourceImagePath) {
    metadata.sourceImagePath = sourceImagePath;
  }

  return {
    prompt: parts.join(' '),
    negativePrompt: buildNegativePrompt(cleanup, activeOutputsMap).join(', '),
    metadata,
  };
}

function describeOutput(
  output: OutputName,
  cleanup: CleanupOptions,
  bodyOptions: BodyOptions,
  includeBodyOptions: boolean
): string {
  switch (output) {
    case 'front':
      return `direct front-facing head/portrait reference, symmetrical, neutral expression, preserving source facial features and proportions${cleanupText(cleanup)}`;
    case 'side':
      return `true 90-degree side profile, same identity, matching source nose, lips, jaw, skull shape, neck, and facial proportions${cleanupText(cleanup)}`;
    case 'body':
      return `full-body character reference, relaxed A/T-pose-like stance, preserving source body shape, build, height-to-width proportions, shoulder/waist/hip balance, limb proportions, and posture cues${includeBodyOptions ? bodyText(bodyOptions) : ''}${cleanupText(cleanup)}`;
  }
}

function sourcePreservationText(): string {
  return 'Identity preservation is mandatory: preserve the original person, facial geometry, eye shape, nose, mouth, jawline, cheekbones, ears, skin tone, visible marks, asymmetry, age impression, and natural expression. Preserve the original body shape, build, height-to-width proportions, shoulder width, waist/hip balance, neck length, limb proportions, and posture cues wherever visible. Do not beautify, age-shift, stylize, slim, bulk, or genericize the person unless an explicit cleanup or body setting requires that specific change. Remove pose, camera perspective, background, clothing/accessories, lighting, and image noise only as needed to produce the requested orthographic reference.';
}

function globalCleanupText(cleanup: CleanupOptions): string {
  const items = cleanupItems(cleanup);
  if (items.length === 0) return '';
  return `Selected cleanup options are mandatory for every requested view: ${items.join(', ')}. Do not reintroduce removed features in side or body outputs.`;
}

function cleanupText(cleanup: CleanupOptions): string {
  const items = cleanupItems(cleanup);
  return items.length > 0 ? `, ${items.join(', ')}` : '';
}

function cleanupItems(cleanup: CleanupOptions): string[] {
  const items: string[] = [];
  if (cleanup.enhanceImage) items.push('enhanced clarity and detail');
  if (cleanup.removeHair) items.push('no hair/bald');
  if (cleanup.removeBeard) items.push('no beard');
  if (cleanup.removeEyebrow) items.push('no eyebrows');
  if (cleanup.removeEyelash) items.push('no eyelashes');
  if (cleanup.removeMakeup) items.push('no makeup');
  return items;
}

function bodyText(bodyOptions: BodyOptions): string {
  return `, ${bodyOptions.bodyShape} body shape as an explicit controlled adjustment while preserving source identity and distinctive build, ${bodyOptions.gender}, ${bodyOptions.physique} physique`;
}

function buildNegativePrompt(
  cleanup: CleanupOptions,
  outputs: Record<OutputName, boolean>
): string[] {
  const negative: string[] = [
    'multiple people',
    'crop errors',
    'cropped head or body',
    'extreme perspective',
    'deformed anatomy',
    'text',
    'watermark',
    'signature',
    'inconsistent identity across views',
    'dramatic lighting',
    'background scene',
    'extra accessories',
    'generic face',
    'changed facial features',
    'changed body shape',
    'changed body proportions',
    'unrequested slimming',
    'unrequested bulking',
    'beautified identity',
  ];

  if (cleanup.removeHair) negative.push('hair');
  if (cleanup.removeBeard) negative.push('beard');
  if (cleanup.removeEyebrow) negative.push('eyebrows');
  if (cleanup.removeEyelash) negative.push('eyelashes');
  if (cleanup.removeMakeup) negative.push('makeup');
  if (!outputs.body) negative.push('full body');

  return negative;
}
