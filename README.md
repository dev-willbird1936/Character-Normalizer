# Character Normalizer

![Character Normalizer hero](docs/assets/hero.png)

Local desktop and browser UI for generating normalized front, side, and body character reference images.

Built by `dev-willbird1936`.

## Features

![Feature overview](docs/assets/feature-overview.png)

- Desktop popup mode through Electron.
- Browser mode through local Express server.
- Front prompt generation.
- Front-photo modification with cleanup toggles.
- Side/body generation from source photos.
- Streaming results: each generated asset appears as soon as it is ready.
- Strong identity-preservation prompt rules for original features, marks, body shape, and proportions.
- Provider adapter layer for Codex CLI, raw image CLI, and mock output.

## Reference Sheet Flow

![Reference sheet demo](docs/assets/reference-sheet-demo.png)

Demo images use public-domain Wikimedia Commons photographs. See [docs/assets/STOCK_SOURCES.json](docs/assets/STOCK_SOURCES.json).

## Install

```bash
npm install
```

## Desktop Popup

```bash
npm run desktop
```

This builds the TypeScript server, starts it on a random local loopback port, and opens the app in a desktop window. The desktop folder picker returns an absolute output path.

## Browser Mode

```bash
npm run dev
```

Open `http://localhost:3000`.

For a non-watch server:

```bash
npm start
```

## Mock Mode

Use mock mode for UI testing without image generation:

```bash
IMAGE_GENERATION_PROVIDER=mock npm run dev
```

On Windows PowerShell:

```powershell
$env:IMAGE_GENERATION_PROVIDER = "mock"
npm run dev
```

## Provider Configuration

Default provider is `codex-cli`. It runs Codex CLI once per requested output and asks `$imagegen` to save a final image path plus JSON asset metadata.

| Variable | Purpose |
| --- | --- |
| `IMAGE_GENERATION_PROVIDER` | Provider id. Built-ins: `codex-cli`, `raw-image-cli`, `mock`. |
| `CODEX_CLI_COMMAND` | Codex CLI binary path. Defaults to `codex` from `PATH`. |
| `CODEX_PROVIDER_ISOLATED_HOME` | Optional isolated Codex home. Set `0` to disable isolation. |
| `IMAGE_GEN_SCRIPT` | Optional script path for `raw-image-cli`. |
| `IMAGE_GEN_PYTHON` | Python executable for `raw-image-cli`. |
| `OPENAI_API_KEY` | Required only by `raw-image-cli`. |

Secrets are redacted from provider logs, but real keys should stay in local environment variables and never be committed.

## Prompt Safety

For source-image modes, the base prompt now explicitly preserves:

- original person and facial geometry
- eye shape, nose, mouth, jawline, cheekbones, ears
- skin tone, visible marks, asymmetry, age impression, expression
- body shape, build, height-to-width proportions
- shoulder width, waist/hip balance, neck length, limb proportions, posture cues

The prompt blocks unrequested beautification, age shifting, stylization, slimming, bulking, or generic identity replacement.

## Development

```bash
npm run build
npm test
```

## Architecture

- `public/`: vanilla JS UI.
- `desktop/`: Electron popup shell and native folder picker bridge.
- `src/server.ts`: Express app, upload/image/apply/generate endpoints.
- `src/generation/`: provider interface, registry, prompt builder, Codex CLI provider, raw image CLI provider, mock provider.
- `tests/`: provider, prompt, and server endpoint coverage.

## Public Release Hygiene

The repository ignores local/private artifacts:

- `.secrets`
- `.env*` except `.env.example`
- `uploads/`
- `output/`
- `Documents/`
- `dist/`
- local generated auth/caches/logs

Before publishing, run:

```bash
rg -n -i "token|secret|api[_-]?key|absolute-private-path|private-character-name|uploads|output" -g "!node_modules" -g "!package-lock.json"
npm run build
npm test
```

Expected matches should be documentation, tests with fake values, or redaction code only.
