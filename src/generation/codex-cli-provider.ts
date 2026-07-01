import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GenerationProgress, ImageGenerationProvider } from './provider.js';
import type { GenerationRequest, GenerationResult, GeneratedAsset, OutputName } from './types.js';
import { buildOutputPrompt } from './prompt-builder.js';

export interface CodexCliProviderConfig {
  command?: string;
  getArgs?: (request: GenerationRequest, output: OutputName) => string[];
  getStdin?: (request: GenerationRequest, output: OutputName) => string | undefined;
  env?: Record<string, string>;
  parseOutput?: (stdout: string, request: GenerationRequest, output: OutputName) => GenerationResult;
  isolatedHome?: string | false;
}

const SECRET_KEY_RE = /(token|secret|password|passwd|api[_-]?key|authorization|credential)/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{32,})\b/g;
const AUTH_HEADER_RE = /(authorization|bearer|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi;
const WINDOWS_COMMAND_EXTENSIONS = ['.cmd', '.bat', '.exe'];

export function defaultCodexArgs(request: GenerationRequest, output: OutputName): string[] {
  const outputDir = path.resolve(request.autoSavePath || 'output');
  const finalMessagePath = getFinalMessagePath(outputDir, output);
  const args = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--cd',
    process.cwd(),
    '--output-last-message',
    finalMessagePath,
  ];

  if (isOutsideWorkspace(outputDir)) {
    args.push('--add-dir', outputDir);
  }

  if (request.sourceImagePath) {
    args.push('--image', request.sourceImagePath);
  }

  args.push('-');
  return args;
}

export function defaultCodexStdin(
  request: GenerationRequest,
  output: OutputName,
  outputDir = path.resolve(request.autoSavePath || 'output')
): string {
  const filePath = path.join(outputDir, `${output}_${Date.now()}.png`);
  const action = request.sourceImagePath
    ? 'edit attached source image when prompt asks to preserve or modify identity; otherwise use it as visual reference'
    : 'generate a new image from prompt';

  return [
    '$imagegen',
    `Task: ${action}.`,
    `Requested output view: ${output}.`,
    `Resolution: ${request.resolution}.`,
    `Provider prompt: ${request.prompt}`,
    `Negative prompt: ${request.negativePrompt}`,
    `Save final image to: ${filePath}`,
    'If generated image is produced at a different local path, copy it to the requested save path.',
    'Return final response as JSON only, no markdown, no prose. Do not include code fences.',
    JSON.stringify({
      assets: [{ output, filePath }],
      metadata: { provider: 'codex-cli', output },
    }),
  ].join('\n');
}

export function defaultParseOutput(
  stdout: string,
  _request: GenerationRequest,
  output: OutputName
): GenerationResult {
  const text = stdout.trim();
  if (!text) {
    throw new Error('Provider produced no output');
  }

  const parsed = parseProviderJson(text);
  if (parsed) {
    if (parsed.assets && Array.isArray(parsed.assets)) {
      const asset = (parsed.assets as GeneratedAsset[])[0] ?? { output, filePath: '' };
      return {
        assets: [{ output, filePath: asset.filePath }],
        metadata: (parsed.metadata as Record<string, unknown>) ?? {},
      };
    }

    if (parsed.files && Array.isArray(parsed.files)) {
      const file = (parsed.files as Array<{ output?: OutputName; path?: string; filePath?: string }>)[0];
      return {
        assets: [{ output, filePath: file?.path ?? file?.filePath ?? '' }],
        metadata: (parsed.metadata as Record<string, unknown>) ?? {},
      };
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return {
      assets: [{ output, filePath: lines[0] }],
      metadata: { rawOutput: text },
    };
  }

  throw new Error('Could not parse provider output');
}

function parseProviderJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

function runCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  stdin?: string,
  label = 'provider'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const executable = resolveWindowsExecutable(command, env, args);
    const startedAt = Date.now();
    logProvider(label, `spawn ${formatCommandForLog(executable.command, executable.args)}`);
    if (stdin !== undefined) {
      logProvider(label, `stdin ${stdin.length} chars`);
    }

    const child = spawn(executable.command, executable.args, {
      env,
      shell: false,
      windowsVerbatimArguments: executable.windowsVerbatimArguments,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      logChunk(label, 'stdout', text, env);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      logChunk(label, 'stderr', text, env);
    });

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }

    child.on('error', (err) => {
      logProvider(label, `failed to start after ${formatDuration(startedAt)}: ${err.message}`);
      reject(new Error(buildStartError(command, err)));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const detailText = sanitizeProviderOutput(stderr, env);
        const detail = detailText ? ` ${detailText}` : '';
        logProvider(label, `exit code ${code} after ${formatDuration(startedAt)}`);
        reject(new Error(`Provider exited with code ${code}.${detail}`));
        return;
      }
      logProvider(label, `exit code 0 after ${formatDuration(startedAt)}; stdout ${stdout.length} chars`);
      resolve(stdout);
    });
  });
}

export function resolveWindowsExecutable(
  command: string,
  env: Record<string, string>,
  args: string[] = []
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (process.platform !== 'win32') {
    return { command, args };
  }

  const resolved = resolveFromPath(command, env);
  const commandToRun = resolved ?? command;
  const ext = path.extname(commandToRun).toLowerCase();

  if (ext === '.cmd' || ext === '.bat') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', quoteCmdCommandLine(commandToRun, args)],
      windowsVerbatimArguments: true,
    };
  }

  return { command: commandToRun, args };
}

function resolveFromPath(command: string, env: Record<string, string>): string | undefined {
  if (path.isAbsolute(command) || command.includes('\\') || command.includes('/')) {
    return command;
  }

  const pathValue = env.Path ?? env.PATH ?? '';
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const hasExt = Boolean(path.extname(command));
  const candidates = hasExt ? [command] : [command, ...WINDOWS_COMMAND_EXTENSIONS.map((ext) => `${command}${ext}`)];

  for (const dir of pathDirs) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      try {
        // Synchronous check keeps spawn adapter deterministic and tiny.
        fs.accessSync(fullPath);
        return fullPath;
      } catch {
        // Keep searching PATH.
      }
    }
  }

  return undefined;
}

function buildStartError(command: string, err: Error): string {
  const configured = process.env.CODEX_CLI_COMMAND
    ? `CODEX_CLI_COMMAND="${process.env.CODEX_CLI_COMMAND}"`
    : 'CODEX_CLI_COMMAND is not set';
  return `Failed to start provider command "${command}": ${err.message}. Install Codex CLI or set ${configured} to the full executable path.`;
}

function quoteCmdCommandLine(command: string, args: string[]): string {
  return `"${[command, ...args].map(quoteCmdArgument).join(' ')}"`;
}

function quoteCmdArgument(value: string): string {
  return `"${value.replace(/(["^&|<>()%])/g, '^$1')}"`;
}

export function sanitizeProviderOutput(output: string, env: Record<string, string>): string {
  let sanitized = output.trim();
  if (!sanitized) return '';

  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 4 || !SECRET_KEY_RE.test(key)) continue;
    sanitized = sanitized.split(value).join('[redacted]');
  }

  sanitized = sanitized
    .replace(AUTH_HEADER_RE, '$1$2[redacted]')
    .replace(SECRET_VALUE_RE, '[redacted]');

  return sanitized.length > 360 ? `${sanitized.slice(0, 360)}...` : sanitized;
}

function prepareIsolatedCodexHome(config: CodexCliProviderConfig): string | undefined {
  if (config.isolatedHome === false || process.env.CODEX_PROVIDER_ISOLATED_HOME === '0') {
    return undefined;
  }

  const isolatedHome =
    config.isolatedHome ||
    process.env.CODEX_PROVIDER_ISOLATED_HOME ||
    path.join(os.tmpdir(), 'character-normalizer-codex-home');

  fs.mkdirSync(isolatedHome, { recursive: true });

  const sourceHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
  const sourceAuth = path.join(sourceHome, 'auth.json');
  const targetAuth = path.join(isolatedHome, 'auth.json');
  if (fs.existsSync(sourceAuth)) {
    fs.copyFileSync(sourceAuth, targetAuth);
  }

  return isolatedHome;
}

function getFinalMessagePath(outputDir: string, output: OutputName): string {
  return path.join(outputDir, `.${output}_${Date.now()}.codex-final.txt`);
}

function logProvider(label: string, message: string): void {
  console.log(`[codex-provider:${label}] ${message}`);
}

function logChunk(label: string, stream: 'stdout' | 'stderr', text: string, env: Record<string, string>): void {
  const sanitized = sanitizeProviderOutput(text, env);
  if (!sanitized) return;
  for (const line of sanitized.split(/\r?\n/).filter(Boolean)) {
    console.log(`[codex-provider:${label}:${stream}] ${line}`);
  }
}

function formatCommandForLog(command: string, args: string[]): string {
  return [command, ...args].map((part) => (
    /\s/.test(part) ? `"${part}"` : part
  )).join(' ');
}

function formatDuration(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function isOutsideWorkspace(targetPath: string): boolean {
  const relative = path.relative(process.cwd(), targetPath);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

export class CodexCliImageProvider implements ImageGenerationProvider {
  readonly id = 'codex-cli';

  constructor(private config: CodexCliProviderConfig = {}) {}

  async generate(request: GenerationRequest, progress: GenerationProgress = {}): Promise<GenerationResult> {
    const command = this.config.command ?? process.env.CODEX_CLI_COMMAND ?? 'codex';
    const activeOutputs = (Object.keys(request.outputs) as OutputName[]).filter((o) => request.outputs[o]);

    if (activeOutputs.length === 0) {
      throw new Error('No outputs requested');
    }

    const isolatedHome = prepareIsolatedCodexHome(this.config);
    const env = {
      ...process.env,
      ...(isolatedHome ? { CODEX_HOME: isolatedHome } : {}),
      ...(this.config.env ?? {}),
    } as Record<string, string>;
    const allAssets: GeneratedAsset[] = [];
    const allMetadata: Record<string, unknown> = { outputsGenerated: activeOutputs };
    console.log(
      `[codex-provider] request mode=${request.mode} outputs=${activeOutputs.join(',')} resolution="${request.resolution}" sourceImage=${request.sourceImagePath ? 'yes' : 'no'} autoSave="${path.resolve(request.autoSavePath || 'output')}"`
    );

    for (const output of activeOutputs) {
      const outputStartedAt = Date.now();
      console.log(`[codex-provider:${output}] start`);
      const singleOutputs: Record<OutputName, boolean> = { front: false, side: false, body: false };
      singleOutputs[output] = true;

      const singleRequest: GenerationRequest = {
        ...request,
        outputs: singleOutputs,
        ...buildOutputPrompt(request, output),
      };

      const args = (this.config.getArgs ?? defaultCodexArgs)(singleRequest, output);
      const stdin = (this.config.getStdin ?? defaultCodexStdin)(singleRequest, output);
      const stdout = await runCommand(command, args, env, stdin, output);
      const finalMessagePath = getArgValue(args, '--output-last-message');
      const finalMessage = finalMessagePath && fs.existsSync(finalMessagePath)
        ? fs.readFileSync(finalMessagePath, 'utf8')
        : stdout;
      const parse = this.config.parseOutput ?? defaultParseOutput;
      const result = parse(finalMessage, singleRequest, output);
      if (finalMessagePath) {
        fs.rmSync(finalMessagePath, { force: true });
      }
      const asset = result.assets[0] ?? { output, filePath: '' };
      if (isolatedHome) {
        ensureAssetExists(asset, isolatedHome, output);
      }
      allAssets.push(asset);
      await progress.onAsset?.(asset);
      Object.assign(allMetadata, result.metadata);
      console.log(`[codex-provider:${output}] parsed asset="${asset.filePath}" after ${formatDuration(outputStartedAt)}`);
    }

    return { assets: allAssets, metadata: allMetadata };
  }
}

function getArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

function ensureAssetExists(asset: GeneratedAsset, isolatedHome: string, output: OutputName): void {
  if (!asset.filePath || fs.existsSync(asset.filePath)) return;

  const generatedDir = path.join(isolatedHome, 'generated_images');
  const source = findNewestImage(generatedDir);
  if (!source) {
    console.warn(`[codex-provider:${output}] parsed asset missing and no generated image found: "${asset.filePath}"`);
    return;
  }

  fs.mkdirSync(path.dirname(asset.filePath), { recursive: true });
  fs.copyFileSync(source, asset.filePath);
  console.log(`[codex-provider:${output}] copied generated image from "${source}" to "${asset.filePath}"`);
}

function findNewestImage(root: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;

  const images: Array<{ filePath: string; mtimeMs: number }> = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) continue;
      const stat = fs.statSync(fullPath);
      images.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
    }
  };

  visit(root);
  images.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return images[0]?.filePath;
}
