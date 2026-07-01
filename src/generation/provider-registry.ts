import type { ImageGenerationProvider } from './provider.js';
import { CodexCliImageProvider } from './codex-cli-provider.js';
import { MockImageProvider } from './mock-provider.js';
import { RawImageCliProvider } from './raw-image-cli-provider.js';

export class ProviderRegistry {
  private providers = new Map<string, ImageGenerationProvider>();

  register(provider: ImageGenerationProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ImageGenerationProvider | undefined {
    return this.providers.get(id);
  }

  getDefault(): ImageGenerationProvider {
    const id = process.env.IMAGE_GENERATION_PROVIDER;
    if (id) {
      const provider = this.providers.get(id);
      if (provider) return provider;
    }

    const first = this.providers.values().next().value as ImageGenerationProvider | undefined;
    if (!first) {
      throw new Error('No image generation provider registered');
    }
    return first;
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new CodexCliImageProvider());
  registry.register(new RawImageCliProvider());
  registry.register(new MockImageProvider());
  return registry;
}
