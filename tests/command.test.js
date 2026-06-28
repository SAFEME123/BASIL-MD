import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AddCommand,
  getCommand,
  listCommands,
  unregisterCommand,
} from '../command.js';

describe('command registry', () => {
  const registered = [];

  afterEach(() => {
    for (const name of registered) {
      try { unregisterCommand(name); } catch { /* already removed */ }
    }
    registered.length = 0;
  });

  function register(pattern, overrides = {}) {
    registered.push(pattern);
    AddCommand(
      { pattern, desc: `Test ${pattern}`, category: 'test', filename: 'test.js', ...overrides },
      async () => 'ok',
    );
  }

  describe('AddCommand', () => {
    it('registers a command that can be retrieved', () => {
      register('testcmd1');
      const cmd = getCommand('testcmd1');
      assert.ok(cmd, 'command should be found');
      assert.strictEqual(cmd.pattern, 'testcmd1');
      assert.strictEqual(cmd.desc, 'Test testcmd1');
      assert.strictEqual(cmd.category, 'test');
    });

    it('stores the handler function', () => {
      register('testcmd2');
      const cmd = getCommand('testcmd2');
      assert.strictEqual(typeof cmd.function, 'function');
    });
  });

  describe('getCommand', () => {
    it('returns the correct command by pattern', () => {
      register('alpha');
      register('beta');
      const cmd = getCommand('beta');
      assert.strictEqual(cmd.pattern, 'beta');
    });

    it('returns undefined/null for an unregistered pattern', () => {
      const cmd = getCommand('nonexistent_cmd_xyz');
      assert.ok(!cmd, 'should not find unregistered command');
    });
  });

  describe('listCommands', () => {
    it('returns an array including registered commands', () => {
      register('listtest1');
      register('listtest2');
      const list = listCommands();
      assert.ok(Array.isArray(list));
      const patterns = list.map(c => c.pattern);
      assert.ok(patterns.includes('listtest1'));
      assert.ok(patterns.includes('listtest2'));
    });
  });

  describe('unregisterCommand', () => {
    it('removes a previously registered command', () => {
      register('removeme');
      assert.ok(getCommand('removeme'));
      unregisterCommand('removeme');
      registered.pop();
      assert.ok(!getCommand('removeme'), 'command should no longer exist');
    });

    it('is idempotent for already-removed commands', () => {
      register('gone');
      unregisterCommand('gone');
      registered.pop();
      assert.doesNotThrow(() => unregisterCommand('gone'));
    });
  });
});
