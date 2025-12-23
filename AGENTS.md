## Purpose
- This repository is a VS Code extension project.
- AI agents are allowed to contribute but must follow this contract.

## Toolchain Rules
- Do not change pinned versions without explicit instruction.
- Do not introduce `latest`, ranges, or floating versions.
- Toolchain upgrades require documentation in `README.md`.
- `mise` itself is managed externally (package manager), do not pin it in this repo.

## Engineering Rules
- Dispose all VS Code disposables.
- Handle errors gracefully.
- Keep modules small and explicit.

## AI Rules
- Do not refactor unrelated code.
- Prefer TODO over speculation.
- Respect repository structure and constraints.
