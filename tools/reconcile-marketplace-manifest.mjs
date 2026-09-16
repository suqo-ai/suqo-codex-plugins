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
 *     <reconciled-plugin.json> <generated-marketplace.json> [plugin-name] [--rename-to <name>]
 *
 * <reconciled-plugin.json> should already have gone through
 * reconcile-plugin-manifest.mjs — this script reads its description/version
 * back out to stamp onto the matching marketplace entry. If the marketplace
 * lists more than one plugin, pass [plugin-name] to target a specific entry;
 * otherwise the first entry is used.
 *
 * --rename-to renames the matched entry's `name` and updates its
 * `source.path` to match (Codex's plugin folder convention is
 * `./plugins/<name>`) - a deliberate override, not a "fill a gap" fix.
 * Pass the same --rename-to value given to reconcile-plugin-manifest.mjs
 * so the plugin.json and marketplace.json agree on the new name.
 *
 * It also rewrites any occurrence of the entry's pre-rename name inside the
 * marketplace's own top-level `name` and `interface.displayName` - both are
 * set by acplugin from the source's own marketplace.json and otherwise keep
 * saying e.g. "suqo-claude-plugins-marketplace" even after the listed
 * plugin has been correctly renamed, which is exactly the
 * confusing-branding bug this whole rename exists to fix.
 *
 * [plugin-name] doubles as the reliable "pre-rename name" anchor for that
 * rewrite (not `entry.name`, which becomes the *new* name after the first
 * run) - a real bug, found by review and reproduced: reading the anchor
 * from the file this script writes to meant a second run against an
 * already-renamed marketplace.json couldn't find the entry at all
 * (`findEntry` matched on the old name only) and exited with an error.
 * `[plugin-name]` is a CLI argument, not something this script's own
 * output ever changes, so it stays a valid anchor no matter how many times
 * this has already run - and `findEntry` below also falls back to matching
 * on `--rename-to` itself, so a second run finds the (already-renamed)
 * entry and correctly reports no further changes needed, rather than
 * failing. See the idempotency test.
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
  const [pluginJsonPath, marketplaceJsonPath, targetName] = positional;
  if (!pluginJsonPath || !marketplaceJsonPath) {
    console.error('Usage: node tools/reconcile-marketplace-manifest.mjs <reconciled-plugin.json> <generated-marketplace.json> [plugin-name] [--rename-to <name>]');
    process.exit(1);
  }

  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  const marketplace = JSON.parse(readFileSync(marketplaceJsonPath, 'utf8'));

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
    const oldName = targetName ?? entry.name;
    if (oldName !== renameTo) {
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

      const rename = (str) => str.split(oldName).join(renameTo);

      if (typeof marketplace.name === 'string' && marketplace.name.includes(oldName)) {
        const before = marketplace.name;
        const after = rename(before);
        if (after !== before) {
          marketplace.name = after;
          changed.push(`marketplace name: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        }
      }
      if (
        marketplace.interface && typeof marketplace.interface === 'object' &&
        typeof marketplace.interface.displayName === 'string' && marketplace.interface.displayName.includes(oldName)
      ) {
        const before = marketplace.interface.displayName;
        const after = rename(before);
        if (after !== before) {
          marketplace.interface.displayName = after;
          changed.push(`marketplace interface.displayName: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        }
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
