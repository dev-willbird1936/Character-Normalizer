import path from 'node:path';
import fs from 'node:fs/promises';
import type { GenerationProgress, ImageGenerationProvider } from './provider.js';
import type { GenerationRequest, GenerationResult, OutputName } from './types.js';

export class MockImageProvider implements ImageGenerationProvider {
  readonly id = 'mock';

  async generate(request: GenerationRequest, progress: GenerationProgress = {}): Promise<GenerationResult> {
    const activeOutputs = (Object.keys(request.outputs) as OutputName[]).filter((o) => request.outputs[o]);
    if (activeOutputs.length === 0) {
      throw new Error('No outputs requested');
    }

    const outDir = path.resolve(request.autoSavePath || 'output');
    await fs.mkdir(outDir, { recursive: true });

    const timestamp = Date.now();
    const assets = [];
    for (const output of activeOutputs) {
      const filePath = path.join(outDir, `${output}_${timestamp}.svg`);
      const svg = makePlaceholderSvg(output, request.prompt);
      await fs.writeFile(filePath, svg);
      const asset = { output, filePath };
      assets.push(asset);
      await progress.onAsset?.(asset);
    }

    return {
      assets,
      metadata: { provider: 'mock', outputs: activeOutputs },
    };
  }
}

function makePlaceholderSvg(output: OutputName, prompt: string): string {
  const label = output.charAt(0).toUpperCase() + output.slice(1);
  const text = prompt ? `${label}: ${prompt.slice(0, 60)}` : `${label} output`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#2a2a2a"/>
  <rect x="20" y="20" width="472" height="472" fill="none" stroke="#7bd000" stroke-width="8"/>
  <text x="256" y="240" font-family="sans-serif" font-size="32" fill="#e0e0e0" text-anchor="middle">${label}</text>
  <text x="256" y="290" font-family="sans-serif" font-size="16" fill="#888" text-anchor="middle">${escapeXml(text)}</text>
</svg>`.trim();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
