import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTypingDelay,
  calculateReadingDelay,
  getRandomDelay,
  shouldAddHumanDelay,
  sleep,
} from '../lib/humanBehavior.js';

describe('humanBehavior', () => {
  describe('calculateTypingDelay', () => {
    it('returns a positive number for normal text', () => {
      const delay = calculateTypingDelay('hello');
      assert.strictEqual(typeof delay, 'number');
      assert.ok(delay > 0);
    });

    it('returns a longer delay for longer text', () => {
      const short = calculateTypingDelay('hi');
      const long = calculateTypingDelay('this is a much longer message with many characters');
      assert.ok(long > short, `long (${long}) should exceed short (${short})`);
    });

    it('returns a minimum delay for empty input', () => {
      const delay = calculateTypingDelay('');
      assert.strictEqual(typeof delay, 'number');
      assert.ok(delay >= 0);
    });
  });

  describe('calculateReadingDelay', () => {
    it('returns a positive number for normal text', () => {
      const delay = calculateReadingDelay('hello');
      assert.strictEqual(typeof delay, 'number');
      assert.ok(delay > 0);
    });

    it('returns a longer delay for longer text', () => {
      const short = calculateReadingDelay('hi');
      const long = calculateReadingDelay('a much longer message with many words to read carefully');
      assert.ok(long > short, `long (${long}) should exceed short (${short})`);
    });
  });

  describe('getRandomDelay', () => {
    it('returns a value within the specified range', () => {
      for (let i = 0; i < 20; i++) {
        const delay = getRandomDelay(100, 500);
        assert.ok(delay >= 100, `delay ${delay} should be >= 100`);
        assert.ok(delay <= 500, `delay ${delay} should be <= 500`);
      }
    });

    it('returns an integer', () => {
      const delay = getRandomDelay(100, 500);
      assert.strictEqual(delay, Math.floor(delay));
    });
  });

  describe('shouldAddHumanDelay', () => {
    it('returns a boolean', () => {
      const result = shouldAddHumanDelay();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('sleep', () => {
    it('is a function', () => {
      assert.strictEqual(typeof sleep, 'function');
    });

    it('resolves after the specified delay', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `elapsed ${elapsed}ms should be >= 40ms`);
    });
  });
});
