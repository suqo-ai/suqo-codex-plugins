#!/usr/bin/env node
/**
 * Reconcile fields missing from acplugin's generated marketplace.json.
 *
 * acplugin's marketplace entry only ever carries name/source/policy/category
 * (see converter/pluginManifest.ts: convertMarketplaceForCodex) — it never
 * copies the plugin's own description or version onto the marketplace
 * entry, and JSON.stringify doesn't add a trailing newline. Neither omission
 * breaks `codex plugin add` (confirmed by the real install test this
 * script's caller should still run), but both are real metadata gaps a
 * marketplace listing shouldn't ship with.
 *
 * Usage:
 *   node tools/reconcile-marketplace-manifest.mjs \
 *     <reconciled-plugin.json> <generated-marketplace.json> <source-marketplace.json> \
 *     [plugin-name] [--rename-to <name>]
 *
 * <reconciled-plugin.json> should already have gone through
 * reconcile-plugin-manifest.mjs — this script reads its description/version
 * back out to stamp onto the matching marketplace entry. <source-marketplace.json>
 * is the Claude plugin's own .claude-plugin/marketplace.json - used only to
 * derive the pre-rename marketplace name (see --rename-to below). If the
 * marketplace lists more than one plugin, pass [plugin-name] to target a
 * specific entry; otherwise the first entry is used.
 *
 * --rename-to renames the matched entry's `name` and updates its
 * `source.path` to match (Codex's plugin folder convention is
 * `./plugins/<name>`) - a deliberate override, not a "fill a gap" fix.
 * Pass the same --rename-to value given to reconcile-plugin-manifest.mjs
 * so the plugin.json and marketplace.json agree on the new name.
 *
 * It also rewrites the marketplace's own top-level `name` and
 * `interface.displayName` when they embed the plugin's pre-rename name -
 * both are set by acplugin from the source's own marketplace.json and
 * otherwise keep saying e.g. "suqo-claude-plugins-marketplace" even after
 * the listed plugin has been correctly renamed, which is exactly the
 * confusing-branding bug this whole rename exists to fix.
 *
 * This rewrite is derived fresh from <source-marketplace.json> every run,
 * not by detecting and editing whatever's already in the generated file -
 * mirroring reconcile-plugin-manifest.mjs's homepage/repository pattern,
 * which has the same property for the same reason. Two real bugs came
 * from an earlier version that instead mutated the generated marketplace's
 * `name`/`interface.displayName` in place, using substring-presence
 * heuristics to guess whether a rewrite was still needed - found by
 * review, both reproduced before fixing:
 *
 *   1. Compounding: if --rename-to's value ever itself contained the old
 *      name as a substring (e.g. "suqo-claude-plugins" -> "suqo-claude-
 *      plugins-v2"), the old heuristic re-matched on every subsequent run
 *      and kept re-appending, e.g. "...-v2-marketplace" ->
 *      "...-v2-v2-marketplace" -> "...-v2-v2-v2-marketplace".
 *   2. False negative: patching (1) by also requiring the new name be
 *      *absent* broke the case where the new name coincidentally already
 *      appeared in the marketplace name for unrelated reasons on a
 *      genuinely first run - the needed rewrite silently never happened,
 *      with no error and no line in the reconciled-fields log.
 *
 * Deriving the expected value directly from the untouched source every
 * run - rather than asking "does the current value look already
 * rewritten?" - has neither failure mode: source never changes, so the
 * expected value is identical (and correct) no matter how many times this
 * has already run.
 *
 * Writes the reconciled marketplace.json back in place, with a trailing
 * newline.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const KNOWN_FLAGS = new Set(['--rename-to']);

function findEntry(marketplace, targetName, renameTo) {
  if (!targetName) return marketplace.plugins?.[0];
  return marketplace.plugins?.find((p) => p.name === targetName)
    ?? (renameTo ? marketplace.plugins?.find((p) => p.name === renameTo) : undefined);
}

// Strict on purpose - see reconcile-plugin-manifest.mjs's identical
// rationale: a silently-ignored malformed flag defeats the whole point of
// this living in the pipeline instead of being a hand-edit.
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        console.error(`Unsupported "--flag=value" syntax: "${arg}". Use "--flag value" (space-separated).`);
        process.exit(1);
      }
      if (!KNOWN_FLAGS.has(arg)) {
        console.error(`Unrecognized flag: "${arg}".`);
        process.exit(1);
      }
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Flag "${arg}" requires a value.`);
        process.exit(1);
      }
      flags[arg] = value;
    } else {
      positional.push(arg);
    }
  }
  return { positional, renameTo: flags['--rename-to'] };
}

function main() {
  const { positional, renameTo } = parseArgs(process.argv.slice(2));
  const [pluginJsonPath, marketplaceJsonPath, sourceMarketplaceJsonPath, targetName] = positional;
  if (!pluginJsonPath || !marketplaceJsonPath || !sourceMarketplaceJsonPath) {
    console.error('Usage: node tools/reconcile-marketplace-manifest.mjs <reconciled-plugin.json> <generated-marketplace.json> <source-marketplace.json> [plugin-name] [--rename-to <name>]');
    process.exit(1);
  }

  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  const marketplace = JSON.parse(readFileSync(marketplaceJsonPath, 'utf8'));
  const sourceMarketplace = JSON.parse(readFileSync(sourceMarketplaceJsonPath, 'utf8'));

  const entry = findEntry(marketplace, targetName, renameTo);

  if (!entry) {
    console.error(`No matching marketplace entry found${targetName ? ` for "${targetName}"` : ''}.`);
    process.exit(1);
  }

  const changed = [];
  if (plugin.description !== undefined && entry.description !== plugin.description) {
    changed.push(`description: ${JSON.stringify(entry.description) ?? '(absent)'} -> ${JSON.stringify(plugin.description)}`);
    entry.description = plugin.description;
  }
  if (plugin.version !== undefined && entry.version !== plugin.version) {
    changed.push(`version: ${JSON.stringify(entry.version) ?? '(absent)'} -> ${JSON.stringify(plugin.version)}`);
    entry.version = plugin.version;
  }
  if (renameTo !== undefined) {
    // Prefer the CLI-supplied pre-rename name (stable across runs) over
    // entry.name (which becomes the *new* name after the first run).
    const entryOldName = targetName ?? entry.name;
    if (entryOldName !== renameTo) {
      if (entry.name !== renameTo) {
        changed.push(`name: ${JSON.stringify(entry.name)} -> ${JSON.stringify(renameTo)}`);
        entry.name = renameTo;
      }
      if (entry.source && typeof entry.source === 'object') {
        const newPath = `./plugins/${renameTo}`;
        if (entry.source.path !== newPath) {
          changed.push(`source.path: ${JSON.stringify(entry.source.path)} -> ${JSON.stringify(newPath)}`);
          entry.source.path = newPath;
        }
      }
    }

    // Marketplace-level rewrite: always derived fresh from the untouched
    // source, never from marketplace.name/interface.displayName - see the
    // doc comment above for why.
    const sourceMarketplaceName = sourceMarketplace.name;
    if (typeof sourceMarketplaceName === 'string') {
      const expectedName = sourceMarketplaceName.includes(entryOldName)
        ? sourceMarketplaceName.split(entryOldName).join(renameTo)
        : sourceMarketplaceName; // doesn't embed the plugin's name - nothing to rename.

      if (typeof marketplace.name === 'string' && marketplace.name !== expectedName) {
        changed.push(`marketplace name: ${JSON.stringify(marketplace.name)} -> ${JSON.stringify(expectedName)}`);
        marketplace.name = expectedName;
      }
      // acplugin has no source concept for interface.displayName (Claude's
      // marketplace.json carries no `interface` field at all) - it always
      // defaults this to match marketplace.name, so the same expected
      // value applies here too.
      if (marketplace.interface && typeof marketplace.interface === 'object' && marketplace.interface.displayName !== expectedName) {
        changed.push(`marketplace interface.displayName: ${JSON.stringify(marketplace.interface.displayName)} -> ${JSON.stringify(expectedName)}`);
        marketplace.interface.displayName = expectedName;
      }
    }
  }

  writeFileSync(marketplaceJsonPath, JSON.stringify(marketplace, null, 2) + '\n');

  if (changed.length === 0) {
    console.log('No fields needed reconciling (trailing newline still normalized).');
  } else {
    console.log(`Reconciled ${changed.length} field(s) in ${marketplaceJsonPath}:`);
    for (const line of changed) console.log(`  - ${line}`);
  }
}

main();
