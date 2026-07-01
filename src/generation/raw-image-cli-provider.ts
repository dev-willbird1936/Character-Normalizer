import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GenerationProgress, ImageGenerationProvider } from './provider.js';
import type { GenerationRequest, GenerationResult, GeneratedAsset, OutputName } from './types.js';
import { buildOutputPrompt } from './prompt-builder.js';
import { sanitizeProviderOutput } from './codex-cli-provider.js';

export interface RawImageCliProviderConfig {
  pythonCommand?: string;
  scriptPath?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  model?: string;
}

export class RawImageCliProvider implements ImageGenerationProvider {
  readonly id = 'raw-image-cli';

  constructor(private config: RawImageCliProviderConfig = {}) {}

  async generate(request: GenerationRequest, progress: GenerationProgress = {}): Promise<GenerationResult> {
    const activeOutputs = (Object.keys(request.outputs) as OutputName[]).filter((o) => request.outputs[o]);
    if (activeOutputs.length === 0) {
      throw new Error('No outputs requested');
    }

    const env = process.env as Record<string, string>;
    const pythonCommand = this.config.pythonCommand ?? process.env.IMAGE_GEN_PYTHON ?? 'python';
    const scriptPath = this.config.scriptPath ?? process.env.IMAGE_GEN_SCRIPT ?? defaultImageGenScriptPath();
    const size = mapResolutionToImageSize(request.resolution);
    const quality = this.config.quality ?? (process.env.IMAGE_GEN_QUALITY as RawImageCliProviderConfig['quality']) ?? 'medium';
    const model = this.config.model ?? process.env.IMAGE_GEN_MODEL ?? 'gpt-image-2';
    const outDir = path.resolve(request.autoSavePath || 'output');
    await fs.mkdir(outDir, { recursive: true });

    console.log(
      `[raw-image-cli] request mode=${request.mode} outputs=${activeOutputs.join(',')} size=${size} quality=${quality} sourceImage=${request.sourceImagePath ? 'yes' : 'no'} out="${outDir}"`
    );

    const assets: GeneratedAsset[] = [];
    for (const output of activeOutputs) {
      const outputStartedAt = Date.now();
      const singleOutputs: Record<OutputName, boolean> = { front: false, side: false, body: false };
      singleOutputs[output] = true;
      const singleRequest: GenerationRequest = {
        ...request,
        outputs: singleOutputs,
        ...buildOutputPrompt(request, output),
      };

      const promptFile = path.join(outDir, `.${output}_${Date.now()}.prompt.txt`);
      const outPath = path.join(outDir, `${output}_${Date.now()}.png`);
      await fs.writeFile(promptFile, buildRawImagePrompt(singleRequest), 'utf8');

      const args = buildRawImageCliArgs({
        scriptPath,
        request: singleRequest,
        output,
        promptFile,
        outPath,
        size,
        quality,
        model,
      });

      console.log(`[raw-image-cli:${output}] spawn ${formatCommandForLog(pythonCommand, args)}`);
      await runRawCommand(pythonCommand, args, env, output);
      await fs.rm(promptFile, { force: true });

      const asset = { output, filePath: outPath };
      assets.push(asset);
      await progress.onAsset?.(asset);
      console.log(`[raw-image-cli:${output}] complete asset="${outPath}" after ${formatDuration(outputStartedAt)}`);
    }

    return {
      assets,
      metadata: {
        provider: this.id,
        model,
        quality,
        size,
        outputsGenerated: activeOutputs,
      },
    };
  }
}

export function buildRawImageCliArgs(input: {
  scriptPath: string;
  request: GenerationRequest;
  output: OutputName;
  promptFile: string;
  outPath: string;
  size: string;
  quality: string;
  model: string;
}): string[] {
  const mode = input.request.sourceImagePath ? 'edit' : 'generate';
  const args = [
    input.scriptPath,
    mode,
    '--model',
    input.model,
    '--prompt-file',
    input.promptFile,
    '--size',
    input.size,
    '--quality',
    input.quality,
    '--output-format',
    'png',
    '--out',
    input.outPath,
    '--force',
    '--no-augment',
  ];

  if (input.request.sourceImagePath) {
    args.push('--image', input.request.sourceImagePath);
  }

  return args;
}

export function buildRawImagePrompt(request: GenerationRequest): string {
  return [
    request.prompt,
    '',
    `Avoid: ${request.negativePrompt}`,
    'No text or watermark.',
  ].join('\n');
}

export function mapResolutionToImageSize(resolution: string): string {
  if (resolution.startsWith('1024')) return '1024x1024';
  if (resolution.startsWith('2K')) return '2048x2048';
  if (resolution.startsWith('4K')) return '2880x2880';
  if (resolution.startsWith('8K')) return '2880x2880';
  return 'auto';
}

function defaultImageGenScriptPath(): string {
  const userProfile = process.env.USERPROFILE ?? process.env.HOME;
  if (!userProfile) return 'image_gen.py';
  return path.join(userProfile, '.brain', 'skills', '.system', 'imagegen', 'scripts', 'image_gen.py');
}

function runRawCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  output: OutputName
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { env, shell: false });
    let stderr = '';

    child.stdout?.on('data', (data) => {
      logChunk(output, 'stdout', data.toString(), env);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      logChunk(output, 'stderr', text, env);
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start raw image CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const detail = sanitizeProviderOutput(stderr, env);
        reject(new Error(`Raw image CLI exited with code ${code}.${detail ? ` ${detail}` : ''}`));
        return;
      }
      console.log(`[raw-image-cli:${output}] exit code 0 after ${formatDuration(startedAt)}`);
      resolve();
    });
  });
}

function logChunk(output: OutputName, stream: 'stdout' | 'stderr', text: string, env: Record<string, string>): void {
  const sanitized = sanitizeProviderOutput(text, env);
  if (!sanitized) return;
  for (const line of sanitized.split(/\r?\n/).filter(Boolean)) {
    console.log(`[raw-image-cli:${output}:${stream}] ${line}`);
  }
}

function formatCommandForLog(command: string, args: string[]): string {
  return [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}

function formatDuration(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}
