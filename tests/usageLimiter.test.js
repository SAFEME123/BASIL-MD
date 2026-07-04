import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_LIMITS,
  GROUP_DAILY_LIMITS,
  checkUsageLimit,
  recordUsage,
  checkGroupLimit,
  recordGroupUsage,
  isAgeVerified,
  setAgeVerified,
  limitMsg,
  ageGateMsg,
} from '../lib/usageLimiter.js';

describe('usageLimiter', () => {
  const uid = () => `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  describe('DAILY_LIMITS', () => {
    it('has free and premium tiers', () => {
      assert.ok('free' in DAILY_LIMITS);
      assert.ok('premium' in DAILY_LIMITS);
    });

    it('free tier has positive limits for standard features', () => {
      assert.ok(DAILY_LIMITS.free.chatbot > 0);
      assert.ok(DAILY_LIMITS.free.imagegen > 0);
    });

    it('premium tier has higher or unlimited limits', () => {
      const freeChat = DAILY_LIMITS.free.chatbot;
      const premChat = DAILY_LIMITS.premium.chatbot;
      assert.ok(premChat === -1 || premChat > freeChat);
    });
  });

  describe('GROUP_DAILY_LIMITS', () => {
    it('is an object with numeric limits', () => {
      assert.strictEqual(typeof GROUP_DAILY_LIMITS, 'object');
      for (const val of Object.values(GROUP_DAILY_LIMITS)) {
        assert.strictEqual(typeof val, 'number');
      }
    });
  });

  describe('checkUsageLimit / recordUsage', () => {
    it('allows usage within the free limit', async () => {
      const id = uid();
      const result = await checkUsageLimit(id, 'imagegen');
      assert.strictEqual(result.allowed, true);
      assert.ok(result.remaining > 0);
    });

    it('blocks usage after exceeding the limit', async () => {
      const id = uid();
      const limit = DAILY_LIMITS.free.imagegen;
      for (let i = 0; i < limit + 1; i++) {
        await recordUsage(id, 'imagegen');
      }
      const result = await checkUsageLimit(id, 'imagegen');
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.remaining, 0);
      assert.strictEqual(result.reason, 'daily_limit');
    });

    it('tracks usage count correctly', async () => {
      const id = uid();
      await recordUsage(id, 'imagegen');
      await recordUsage(id, 'imagegen');
      const result = await checkUsageLimit(id, 'imagegen');
      assert.strictEqual(result.used, 2);
    });
  });

  describe('checkGroupLimit / recordGroupUsage', () => {
    it('allows group usage within limits', async () => {
      const gid = `group-${Date.now()}`;
      const result = await checkGroupLimit(gid, 'imagegen');
      if (result && typeof result === 'object' && 'allowed' in result) {
        assert.strictEqual(result.allowed, true);
      }
    });
  });

  describe('limitMsg', () => {
    it('returns a non-empty string', () => {
      const msg = limitMsg('imagegen', 5);
      assert.strictEqual(typeof msg, 'string');
      assert.ok(msg.length > 0);
    });
  });

  describe('ageGateMsg', () => {
    it('returns a non-empty string mentioning age verification', () => {
      const msg = ageGateMsg();
      assert.strictEqual(typeof msg, 'string');
      assert.ok(msg.length > 0);
      assert.ok(msg.toLowerCase().includes('age') || msg.includes('18'));
    });
  });
});
