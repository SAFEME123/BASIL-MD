import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLikelyVideo } from '../lib/mediaProbe.js';

describe('mediaProbe - isLikelyVideo', () => {
  it('rejects a clearly invalid URL', async () => {
    const result = await isLikelyVideo('not-a-url');
    assert.strictEqual(result.ok, false);
  });

  it('rejects null input', async () => {
    const result = await isLikelyVideo(null);
    assert.strictEqual(result.ok, false);
  });

  it('rejects an empty string', async () => {
    const result = await isLikelyVideo('');
    assert.strictEqual(result.ok, false);
  });

  it('rejects a bare filename', async () => {
    const result = await isLikelyVideo('video.mp4');
    assert.strictEqual(result.ok, false);
  });

  it('returns an object with ok and reason for invalid input', async () => {
    const result = await isLikelyVideo('bad');
    assert.strictEqual(typeof result, 'object');
    assert.ok('ok' in result);
    assert.ok('reason' in result);
  });
});
