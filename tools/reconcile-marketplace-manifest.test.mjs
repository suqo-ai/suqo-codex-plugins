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

    writeJson(pluginPath, {
      name: 'example-plugin',
      version: '0.4.0',
      description: 'Example plugin description.',
    });
    writeJson(marketplacePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', source: { source: 'local', path: './plugins/example-plugin' }, category: 'sdk' }],
    });

    runScript(SCRIPT, [pluginPath, marketplacePath]);
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

    writeJson(pluginPath, { name: 'second-plugin', version: '2.0.0', description: 'Second.' });
    writeJson(marketplacePath, {
      name: 'multi-marketplace',
      plugins: [
        { name: 'first-plugin', source: { source: 'local', path: './plugins/first-plugin' } },
        { name: 'second-plugin', source: { source: 'local', path: './plugins/second-plugin' } },
      ],
    });

    runScript(SCRIPT, [pluginPath, marketplacePath, 'second-plugin']);
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

    writeJson(pluginPath, { name: 'example-plugin', version: '1.0.0', description: 'x' });
    const original = { name: 'example-marketplace', plugins: [{ name: 'other-plugin', source: { source: 'local', path: './plugins/other-plugin' } }] };
    writeJson(marketplacePath, original);

    assert.throws(() => runScript(SCRIPT, [pluginPath, marketplacePath, 'nonexistent-plugin']), (err) => {
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

    writeJson(pluginPath, { name: 'example-plugin', version: '1.0.0', description: 'Same.' });
    writeJson(marketplacePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'example-plugin', description: 'Same.', version: '1.0.0' }],
    });

    const { stdout } = runScript(SCRIPT, [pluginPath, marketplacePath]);

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

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'example-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });

    runScript(SCRIPT, [pluginPath, marketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins']);
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

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'suqo-claude-plugins-marketplace',
      interface: { displayName: 'suqo-claude-plugins-marketplace' },
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });

    runScript(SCRIPT, [pluginPath, marketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins']);
    const result = readJson(marketplacePath);

    assert.equal(result.name, 'suqo-codex-plugins-marketplace');
    assert.equal(result.interface.displayName, 'suqo-codex-plugins-marketplace');
    assert.equal(result.plugins[0].name, 'suqo-codex-plugins');
  } finally {
    cleanup();
  }
});

test('--rename-to leaves an unrelated marketplace name alone', () => {
  const { dir, cleanup } = makeTempDir('reconcile-marketplace-');
  try {
    const pluginPath = join(dir, 'plugin.json');
    const marketplacePath = join(dir, 'marketplace.json');

    writeJson(pluginPath, { name: 'suqo-codex-plugins', version: '1.0.0', description: 'x' });
    writeJson(marketplacePath, {
      name: 'acme-tools-marketplace',
      plugins: [{ name: 'suqo-claude-plugins', source: { source: 'local', path: './plugins/suqo-claude-plugins' } }],
    });

    runScript(SCRIPT, [pluginPath, marketplacePath, 'suqo-claude-plugins', '--rename-to', 'suqo-codex-plugins']);
    const result = readJson(marketplacePath);

    assert.equal(result.name, 'acme-tools-marketplace');
  } finally {
    cleanup();
  }
});
