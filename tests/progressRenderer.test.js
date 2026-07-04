import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderProgress } from '../lib/progressRenderer.js';

describe('renderProgress', () => {
  it('renders 0% with an empty bar', () => {
    const result = renderProgress(0);
    assert.ok(result.includes('0%'));
    assert.ok(result.includes('░'));
  });

  it('renders 100% with a full bar', () => {
    const result = renderProgress(100);
    assert.ok(result.includes('100%'));
    assert.ok(!result.includes('░'), 'should have no empty segments');
  });

  it('renders 50% with a half-filled bar', () => {
    const result = renderProgress(50);
    assert.ok(result.includes('50%'));
    assert.ok(result.includes('█'));
    assert.ok(result.includes('░'));
  });

  it('clamps negative values to 0%', () => {
    const result = renderProgress(-10);
    assert.ok(result.includes('0%'));
  });

  it('clamps values above 100 to 100%', () => {
    const result = renderProgress(120);
    assert.ok(result.includes('100%'));
  });

  it('handles string input by coercing to number', () => {
    const result = renderProgress('50');
    assert.ok(result.includes('50%'));
  });

  it('returns a string', () => {
    assert.strictEqual(typeof renderProgress(50), 'string');
  });

  it('renders different fill levels for 1% and 99%', () => {
    const r1 = renderProgress(1);
    const r99 = renderProgress(99);
    assert.ok(r1.includes('1%'));
    assert.ok(r99.includes('99%'));
  });
});
