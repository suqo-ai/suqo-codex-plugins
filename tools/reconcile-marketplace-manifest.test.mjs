import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, writeJson, readJson, readText, runScript } from './test-utils.mjs';

const SCRIPT = join(fileURLToPath(new URL('.', import.meta.url)), 'reconcile-marketplace-manifest.mjs');

test('adds description and version to the first entry by default', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, {
      name: 'example-plugin',
      version: '0.4.0',
      description: 'Example plugin description.',
    });
    writeJson(marketplacePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', source: { source: 'local', path: './plugins/example-plugin' }, category: 'sdk' }],
    });
    writeJson(sourceMarketplacePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin' }] });

    runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath]);
    const entry = readJson(marketplacePath).plugins[0];

    assert.equal(entry.description, 'Example plugin description.');
    assert.equal(entry.version, '0.4.0');
    // Untouched fields survive.
    assert.equal(entry.category, 'sdk');
  } finally {
    cleanup();
  }
});

test('targets a specific named entry when the marketplace lists more than one plugin', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'second-plugin', version: '2.0.0', description: 'Second.' });
    writeJson(marketplacePath, {
      name: 'multi-marketplace',
      plugins: [
        { name: 'first-plugin', source: { source: 'local', path: './plugins/first-plugin' } },
        { name: 'second-plugin', source: { source: 'local', path: './plugins/second-plugin' } },
      ],
    });
    writeJson(sourceMarketplacePath, { name: 'multi-marketplace', plugins: [{ name: 'second-plugin' }] });

    runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'second-plugin']);
    const [first, second] = readJson(marketplacePath).plugins;

    assert.equal(first.description, undefined);
    assert.equal(second.description, 'Second.');
    assert.equal(second.version, '2.0.0');
  } finally {
    cleanup();
  }
});

test('exits non-zero and leaves the file untouched when no entry matches', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'example-plugin', version: '1.0.0', description: 'x' });
    const original = { name: 'example-marketplace', plugins: [{ name: 'other-plugin', source: { source: 'local', path: './plugins/other-plugin' } }] };
    writeJson(marketplacePath, original);
    writeJson(sourceMarketplacePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin' }] });

    assert.throws(() => runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'nonexistent-plugin']), (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /No matching marketplace entry found for "nonexistent-plugin"/);
      return true;
    });

    assert.deepEqual(readJson(marketplacePath), original);
  } finally {
    cleanup();
  }
});

test('adds a trailing newline even when no field needed reconciling', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'example-plugin', version: '1.0.0', description: 'Same.' });
    writeJson(marketplacePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', description: 'Same.', version: '1.0.0' }],
    });
    writeJson(sourceMarketplacePath, { name: 'example-marketplace', plugins: [{ name: 'example-plugin' }] });

    const { stdout } = runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath]);

    assert.match(stdout, /No fields needed reconciling/);
    const text = readText(marketplacePath);
    assert.ok(text.endsWith('\n'));
    assert.ok(!text.endsWith('\n\n'));
  } finally {
    cleanup();
  }
});

test('exits non-zero with a usage message when arguments are missing', () => {
  assert.throws(() => runScript(SCRIPT, []), (err) => {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /Usage: node tools\/reconcile-marketplace-manifest\.mjs/);
    return true;
  });
});

test('--rename-to overrides the entry name and updates source.path to match', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });
    writeJson(sourceMarketplacePath, { name: 'example-marketplace', plugins: [{ name: 'suqo-claude-plugins' }] });

    runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins']);
    const entry = readJson(marketplacePath).plugins[0];

    assert.equal(entry.name, 'suqo-codex-plugins');
    assert.equal(entry.source.path, './plugins/suqo-codex-plugins');
  } finally {
    cleanup();
  }
});

test('--rename-to also rewrites the marketplace top-level name and interface.displayName', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'suqo-claude-plugins-marketplace',
      interface: { displayName: 'suqo-claude-plugins-marketplace' },
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });
    writeJson(sourceMarketplacePath, { name: 'suqo-claude-plugins-marketplace', plugins: [{ name: 'suqo-claude-plugins' }] });

    runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins']);
    const result = readJson(marketplacePath);

    assert.equal(result.name, 'suqo-codex-plugins-marketplace');
    assert.equal(result.interface.displayName, 'suqo-codex-plugins-marketplace');
    assert.equal(result.plugins[0].name, 'suqo-codex-plugins');
  } finally {
    cleanup();
  }
});

test('does not compound the marketplace-name rewrite across repeated runs when --rename-to itself contains the old name', () => {
  // Regression test #1: an earlier version anchored the rewrite on the
  // *generated* marketplace's own name, which already reflects any prior
  // run's changes. If --rename-to's value itself embeds the old name as a
  // substring (e.g. "suqo-claude-plugins" -> "suqo-claude-plugins-v2"), a
  // second run's marketplace.name already contains the old name as a
  // prefix of the *already-rewritten* value, so a naive rewrite fired
  // again and compounded: "...-marketplace" -> "...-v2-marketplace" ->
  // "...-v2-v2-marketplace". Fixed by deriving the expected value fresh
  // from source-marketplace.json every run (which never changes) instead
  // of mutating the generated value in place.
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'suqo-claude-plugins-v2', version: '0.4.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'suqo-claude-plugins-marketplace',
      interface: { displayName: 'suqo-claude-plugins-marketplace' },
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });
    writeJson(sourceMarketplacePath, { name: 'suqo-claude-plugins-marketplace', plugins: [{ name: 'suqo-claude-plugins' }] });

    const args = [pluginPath, marketplacePath, sourceMarketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-claude-plugins-v2'];
    runScript(SCRIPT, args);
    assert.equal(readJson(marketplacePath).name, 'suqo-claude-plugins-v2-marketplace');

    // Three more runs - a naive fix would compound "-v2" onto the name again each time.
    for (let i = 0; i < 3; i++) runScript(SCRIPT, args);
    const result = readJson(marketplacePath);

    assert.equal(result.name, 'suqo-claude-plugins-v2-marketplace');
    assert.equal(result.interface.displayName, 'suqo-claude-plugins-v2-marketplace');
  } finally {
    cleanup();
  }
});

test('does not silently skip a needed rewrite just because the new name already appears somewhere unrelated', () => {
  // Regression test #2: the fix for regression #1 above (in an earlier,
  // now-replaced version) added a check that skipped the rewrite whenever
  // the *new* name was already present in the current value - which broke
  // exactly this case: a genuinely first run, where the new name
  // coincidentally already appears in the marketplace name for reasons
  // unrelated to any prior run of this script. Found by review,
  // reproduced: renaming "alpha" -> "beta" against a marketplace name
  // "alpha-beta-thing-marketplace" (never touched by this script before)
  // silently left it unchanged instead of producing
  // "beta-beta-thing-marketplace". Deriving the expected value from
  // source-marketplace.json (never mutated) rather than guessing from the
  // current value's contents has neither failure mode.
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'beta', description: 'x', version: '0.4.0' });
    writeJson(marketplacePath, {
      name: 'alpha-beta-thing-marketplace',
      interface: { displayName: 'alpha-beta-thing-marketplace' },
      plugins: [{ name: 'alpha', source: { source: 'local', path: './plugins/alpha' } }],
    });
    writeJson(sourceMarketplacePath, { name: 'alpha-beta-thing-marketplace', plugins: [{ name: 'alpha' }] });

    runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'alpha', '--rename-to', 'beta']);
    const result = readJson(marketplacePath);

    assert.equal(result.name, 'beta-beta-thing-marketplace');
    assert.equal(result.interface.displayName, 'beta-beta-thing-marketplace');
  } finally {
    cleanup();
  }
});

test('running --rename-to twice in a row is a true no-op the second time (idempotency)', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '0.4.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'suqo-claude-plugins-marketplace',
      interface: { displayName: 'suqo-claude-plugins-marketplace' },
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });
    writeJson(sourceMarketplacePath, { name: 'suqo-claude-plugins-marketplace', plugins: [{ name: 'suqo-claude-plugins' }] });

    const args = [pluginPath, marketplacePath, sourceMarketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins'];
    runScript(SCRIPT, args);
    const afterFirstRun = readText(marketplacePath);

    const { stdout } = runScript(SCRIPT, args);
    const afterSecondRun = readText(marketplacePath);

    assert.match(stdout, /No fields needed reconciling/);
    assert.equal(afterSecondRun, afterFirstRun);

    const result = readJson(marketplacePath);
    assert.equal(result.name, 'suqo-codex-plugins-marketplace');
    assert.equal(result.plugins[0].name, 'suqo-codex-plugins');
  } finally {
    cleanup();
  }
});

test('rejects "--flag=value" syntax instead of silently ignoring it', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');
    writeJson(pluginPath, { name: 'x', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, { name: 'm', plugins: [{ name: 'suqo-claude-plugins' }] });
    writeJson(sourceMarketplacePath, { name: 'm', plugins: [{ name: 'suqo-claude-plugins' }] });

    assert.throws(() => runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'suqo-claude-plugins', '--rename-to=suqo-codex-plugins']), (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /Unsupported "--flag=value" syntax/);
      return true;
    });
  } finally {
    cleanup();
  }
});

test('rejects an unrecognized flag instead of silently treating it as positional', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');
    writeJson(pluginPath, { name: 'x' });
    writeJson(marketplacePath, { name: 'm', plugins: [{ name: 'x' }] });
    writeJson(sourceMarketplacePath, { name: 'm', plugins: [{ name: 'x' }] });

    assert.throws(() => runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, '--rename-two', 'y']), (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /Unrecognized flag: "--rename-two"/);
      return true;
    });
  } finally {
    cleanup();
  }
});

test('--rename-to leaves an unrelated marketplace name alone', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');
    const sourceMarketplacePath = join(dir, 'source-marketplace.json');

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'acme-tools-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });
    // The source marketplace's own name has no relation to the plugin's
    // name either - nothing for this script to derive a rename from.
    writeJson(sourceMarketplacePath, { name: 'acme-tools-marketplace', plugins: [{ name: 'suqo-claude-plugins' }] });

    runScript(SCRIPT, [pluginPath, marketplacePath, sourceMarketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins']);
    const result = readJson(marketplacePath);

    assert.equal(result.name, 'acme-tools-marketplace');
  } finally {
    cleanup();
  }
});
