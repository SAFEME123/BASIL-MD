import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getDirname, getFilename, getPathHelpers } from '../lib/path-helpers.js';

describe('path-helpers', () => {
  describe('getPathHelpers', () => {
    it('returns an object with __dirname and __filename', () => {
      const helpers = getPathHelpers(import.meta.url);
      assert.ok('__dirname' in helpers);
      assert.ok('__filename' in helpers);
    });

    it('__dirname is an absolute path', () => {
      const { __dirname: dir } = getPathHelpers(import.meta.url);
      assert.ok(path.isAbsolute(dir), `"${dir}" should be absolute`);
    });

    it('__filename is an absolute path', () => {
      const { __filename: file } = getPathHelpers(import.meta.url);
      assert.ok(path.isAbsolute(file), `"${file}" should be absolute`);
    });

    it('__dirname is the parent of __filename', () => {
      const { __dirname: dir, __filename: file } = getPathHelpers(import.meta.url);
      assert.strictEqual(path.dirname(file), dir);
    });
  });

  describe('getDirname', () => {
    it('returns an absolute directory path', () => {
      const dir = getDirname(import.meta.url);
      assert.strictEqual(typeof dir, 'string');
      assert.ok(path.isAbsolute(dir));
    });
  });

  describe('getFilename', () => {
    it('returns an absolute file path', () => {
      const file = getFilename(import.meta.url);
      assert.strictEqual(typeof file, 'string');
      assert.ok(path.isAbsolute(file));
    });
  });
});
