# line-preview-markdown

Inline markdown previews rendered alongside the focused line (or paragraph) in VS Code,
with an optional rich preview panel.

## Toolchain (pinned)
This repo uses `mise` to keep Node.js and pnpm fully pinned and reproducible.

```bash
mise install
pnpm install
```

Pinned versions live in `mise.toml`. Do not edit them without an explicit instruction and documentation update.

## Development
```bash
pnpm build
pnpm watch
```

Launch the extension with `F5` (Run Extension).

## Testing
```bash
pnpm test
```

## Packaging
```bash
pnpm package
```

Uses local `@vscode/vsce` (no global installs).

## Commands
- `linePreviewMarkdown.toggle`: toggle inline preview
- `linePreviewMarkdown.refresh`: refresh current preview
- `linePreviewMarkdown.togglePanel`: toggle the preview panel (default: Cmd/Ctrl+Shift+M)

## Settings
- `linePreviewMarkdown.enabled`
- `linePreviewMarkdown.maxPreviewLength`
- `linePreviewMarkdown.debounceMs`
- `linePreviewMarkdown.renderMode` (`line` or `paragraph`)
- `linePreviewMarkdown.theme` (`auto`, `light`, `dark`)
- `linePreviewMarkdown.excludeLanguages`

## Pinned Versions Policy
The toolchain is pinned for reproducibility and AI safety. To upgrade:
1) Edit `mise.toml` with new explicit versions.
2) Update this README with the new versions and rationale.
3) Commit as a dedicated toolchain upgrade change.

Current pins:
- node: 22.11.0 (stable LTS)
- pnpm: 9.15.1
