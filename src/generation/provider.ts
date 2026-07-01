import type { GeneratedAsset, GenerationRequest, GenerationResult } from './types.js';

export interface GenerationProgress {
  onAsset?: (asset: GeneratedAsset) => void | Promise<void>;
}

export interface ImageGenerationProvider {
  readonly id: string;
  generate(request: GenerationRequest, progress?: GenerationProgress): Promise<GenerationResult>;
}
