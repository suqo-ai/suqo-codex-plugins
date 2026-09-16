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
 * It also rewrites any occurrence of the entry's *old* name (whatever it
 * was called before this rename) inside the marketplace's own top-level
 * `name` and `interface.displayName` - both are set by acplugin from the
 * source's own marketplace.json and otherwise keep saying e.g.
 * "suqo-claude-plugins-marketplace" even after the listed plugin has been
 * correctly renamed, which is exactly the confusing-branding bug this
 * whole rename exists to fix. Found by review, not hypothetical: this is
 * the one part of the marketplace file --rename-to originally missed.
 *
 * Writes the reconciled marketplace.json back in place, with a trailing
 * newline.
 */

import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const positional = [];
  let renameTo;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rename-to') {
      renameTo = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, renameTo };
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

  const entry = targetName
    ? marketplace.plugins?.find((p) => p.name === targetName)
    : marketplace.plugins?.[0];

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
    const oldName = entry.name;
    if (oldName !== renameTo) {
      changed.push(`name: ${JSON.stringify(oldName)} -> ${JSON.stringify(renameTo)}`);
      entry.name = renameTo;
      if (entry.source && typeof entry.source === 'object') {
        const newPath = `./plugins/${renameTo}`;
        changed.push(`source.path: ${JSON.stringify(entry.source.path)} -> ${JSON.stringify(newPath)}`);
        entry.source.path = newPath;
      }

      const rename = (str) => str.split(oldName).join(renameTo);

      if (typeof marketplace.name === 'string' && marketplace.name.includes(oldName)) {
        const before = marketplace.name;
        marketplace.name = rename(before);
        changed.push(`marketplace name: ${JSON.stringify(before)} -> ${JSON.stringify(marketplace.name)}`);
      }
      if (
        marketplace.interface && typeof marketplace.interface === 'object' &&
        typeof marketplace.interface.displayName === 'string' && marketplace.interface.displayName.includes(oldName)
      ) {
        const before = marketplace.interface.displayName;
        marketplace.interface.displayName = rename(before);
        changed.push(`marketplace interface.displayName: ${JSON.stringify(before)} -> ${JSON.stringify(marketplace.interface.displayName)}`);
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
