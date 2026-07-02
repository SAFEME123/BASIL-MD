import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, MULTI_PREFIXES } from '../lib/parseCommand.js';

describe('parseCommand', () => {
  describe('single-prefix mode', () => {
    it('recognizes a command with the configured prefix', () => {
      const result = parseCommand('.help', '.');
      assert.deepStrictEqual(result, { isCmd: true, cmdName: 'help', prefixUsed: '.' });
    });

    it('extracts only the first word as the command name', () => {
      const result = parseCommand('.menu extra args', '.');
      assert.deepStrictEqual(result, { isCmd: true, cmdName: 'menu', prefixUsed: '.' });
    });

    it('rejects a message that uses a different prefix', () => {
      const result = parseCommand('!help', '.');
      assert.strictEqual(result.isCmd, false);
      assert.strictEqual(result.cmdName, '');
    });

    it('rejects a plain text message', () => {
      const result = parseCommand('hello world', '.');
      assert.strictEqual(result.isCmd, false);
    });

    it('rejects an empty string', () => {
      const result = parseCommand('', '.');
      assert.strictEqual(result.isCmd, false);
    });

    it('works with a non-dot prefix', () => {
      const result = parseCommand('!ban user', '!');
      assert.deepStrictEqual(result, { isCmd: true, cmdName: 'ban', prefixUsed: '!' });
    });

    it('does not recognize a different prefix than configured', () => {
      const result = parseCommand('.help', '!');
      assert.strictEqual(result.isCmd, false);
    });
  });

  describe('multi-prefix mode', () => {
    it('recognizes commands with any prefix from MULTI_PREFIXES', () => {
      const prefixes = ['.', '!', '/', '#', '$', '@'];
      for (const p of prefixes) {
        const result = parseCommand(`${p}help`, '.', true);
        assert.strictEqual(result.isCmd, true, `should recognize "${p}help"`);
        assert.strictEqual(result.cmdName, 'help');
        assert.strictEqual(result.prefixUsed, p);
      }
    });

    it('still rejects plain text', () => {
      const result = parseCommand('hello world', '.', true);
      assert.strictEqual(result.isCmd, false);
    });

    it('still rejects empty input', () => {
      const result = parseCommand('', '.', true);
      assert.strictEqual(result.isCmd, false);
    });
  });

  describe('MULTI_PREFIXES constant', () => {
    it('is an array of single-character strings', () => {
      assert.ok(Array.isArray(MULTI_PREFIXES));
      assert.ok(MULTI_PREFIXES.length > 0);
      for (const p of MULTI_PREFIXES) {
        assert.strictEqual(typeof p, 'string');
        assert.strictEqual(p.length, 1, `prefix "${p}" should be a single char`);
      }
    });

    it('includes the common prefixes', () => {
      for (const p of ['.', '!', '/', '#', '@']) {
        assert.ok(MULTI_PREFIXES.includes(p), `should include "${p}"`);
      }
    });
  });
});
