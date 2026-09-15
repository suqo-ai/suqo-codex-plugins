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
