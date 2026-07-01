export type OutputName = 'front' | 'side' | 'body';

export type Mode = 'front-generate' | 'front-modify' | 'side-body';

export type BodyShape = 'average' | 'heavy' | 'slim';
export type Gender = 'male' | 'female';
export type Physique = 'normal' | 'muscular';

export interface CleanupOptions {
  enhanceImage: boolean;
  removeHair: boolean;
  removeBeard: boolean;
  removeEyebrow: boolean;
  removeEyelash: boolean;
  removeMakeup: boolean;
}

export interface BodyOptions {
  bodyShape: BodyShape;
  gender: Gender;
  physique: Physique;
}

export interface FormState {
  mode: Mode;
  prompt: string;
  sourceImagePath?: string;
  outputs: Record<OutputName, boolean>;
  resolution: string;
  autoSavePath: string;
  cleanup: CleanupOptions;
  bodyOptions: BodyOptions;
}

export interface NormalizationPrompt {
  prompt: string;
  negativePrompt: string;
  metadata: Record<string, unknown>;
}

export interface GeneratedAsset {
  output: OutputName;
  filePath: string;
}

export interface GenerationResult {
  assets: GeneratedAsset[];
  metadata: Record<string, unknown>;
}

export interface GenerationRequest extends FormState, NormalizationPrompt {}
