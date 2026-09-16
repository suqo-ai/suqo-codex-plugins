# suqo-codex-plugins

A Codex plugin providing [SUQO](https://github.com/suqo-ai)'s SDK-usage skills — automatically kept in sync with [`suqo-ai/suqo-claude-plugins`](https://github.com/suqo-ai/suqo-claude-plugins), the source of truth.

This repo isn't hand-written. Its content is generated from the Claude plugin and converted into Codex's plugin format; see [How this stays in sync](#how-this-stays-in-sync) below.

## Install

Requires the [Codex CLI](https://www.npmjs.com/package/@openai/codex) installed first (`npm install -g @openai/codex`).

```
codex plugin marketplace add https://github.com/suqo-ai/suqo-codex-plugins
codex plugin add suqo-codex-plugins@suqo-codex-plugins-marketplace
```

Once installed, Codex has the SUQO PHP and TypeScript SDK usage skills built in — correct method signatures, common pitfalls, and webhook-handling patterns, without needing to explain any of it per session.

## Structure

```
suqo-codex-plugins/
  .agents/plugins/marketplace.json        # marketplace listing (this repo's own entry)
  plugins/suqo-codex-plugins/
    .codex-plugin/plugin.json             # plugin manifest
    .agents/skills/
      ts-sdk-usage/                       # SUQO TypeScript SDK skill
      php-sdk-usage/                      # SUQO PHP SDK skill
  tools/                                  # scripts used to (re)generate the above - see below
  .github/workflows/                      # CI that verifies the above stays in sync - see below
  .source-sync                            # the suqo-claude-plugins commit this repo was last synced from
```

## How this stays in sync

1. **[`acplugin`](https://github.com/TokenRollAI/acplugin)** (MIT, pinned to `1.7.0`) converts the Claude plugin's skills and manifest into Codex's format.
2. **`tools/reconcile-plugin-manifest.mjs`** and **`tools/reconcile-marketplace-manifest.mjs`** patch two known gaps in `acplugin`'s Codex output (it drops `version`/`author`/`homepage`/`license`/`keywords` from `plugin.json`, and `description`/`version` from `marketplace.json`) by re-reading them from the real source.
3. Every regeneration is verified with a real `codex plugin add` install before being committed.

### CI

- **`.github/workflows/verify-sync.yml`** — on every PR: runs `tools/*.test.mjs`, then re-runs the conversion above against `suqo-claude-plugins` pinned to the commit recorded in `.source-sync`, and fails if the result doesn't match what's committed.
- **`.github/workflows/check-source-drift.yml`** — weekly: checks whether `suqo-claude-plugins` has moved past `.source-sync`, and opens a GitHub issue if so. Doesn't block anything - a human decides when to re-sync.

### Manually re-syncing

```bash
npx --yes @disdjj/acplugin@1.7.0 convert <path-to-suqo-claude-plugins> --all --to codex -o <scratch-dir>
node tools/reconcile-plugin-manifest.mjs <path-to-suqo-claude-plugins>/.claude-plugin/plugin.json <scratch-dir>/.codex-plugin/plugin.json --rename-to suqo-codex-plugins
node tools/reconcile-marketplace-manifest.mjs <scratch-dir>/.codex-plugin/plugin.json <scratch-dir>/.agents/plugins/marketplace.json <path-to-suqo-claude-plugins>/.claude-plugin/marketplace.json suqo-claude-plugins --rename-to suqo-codex-plugins
```

`acplugin` always names the plugin after the source ("suqo-claude-plugins") regardless of target tool - `--rename-to` overrides that to match this repo's own identity; see [why](#how-this-stays-in-sync) in the reconcile scripts' doc comments.

Copy the result into `plugins/suqo-codex-plugins/` and `.agents/plugins/marketplace.json`, verify with a real `codex plugin add`, and update `.source-sync` to the commit you converted from.

## License

Apache-2.0 (see [LICENSE](LICENSE)). This repo, and the plugin it ships, have zero dependencies — `tools/` uses only Node's built-ins plus `npx` at conversion time, never installed as a project dependency.
