import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  checkAndUpdateCooldown,
  getUserStats,
  banUser,
  unbanUser,
  getUserBanStatus,
  clearUserCooldowns,
  getGlobalCooldownStats,
  setUserFlags,
  loadCooldowns,
} from '../core/cooldowns.js';

describe('cooldowns', () => {
  const uid = () => `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  describe('DEFAULT_CONFIG', () => {
    it('exposes expected configuration keys', () => {
      assert.ok('defaultCooldown' in DEFAULT_CONFIG);
      assert.ok('defaultBanAfter' in DEFAULT_CONFIG);
      assert.ok('maxBanLevel' in DEFAULT_CONFIG);
      assert.ok('offenseResetTime' in DEFAULT_CONFIG);
      assert.ok('globalRateLimitPerDay' in DEFAULT_CONFIG);
      assert.ok('categoryRateLimits' in DEFAULT_CONFIG);
    });

    it('has sensible default values', () => {
      assert.strictEqual(typeof DEFAULT_CONFIG.defaultCooldown, 'number');
      assert.ok(DEFAULT_CONFIG.defaultCooldown > 0);
      assert.strictEqual(typeof DEFAULT_CONFIG.globalRateLimitPerDay, 'number');
    });

    it('includes category rate limits', () => {
      const cats = DEFAULT_CONFIG.categoryRateLimits;
      assert.strictEqual(typeof cats, 'object');
      assert.ok(Object.keys(cats).length > 0);
    });
  });

  describe('checkAndUpdateCooldown', () => {
    it('allows the first call for a new user', async () => {
      const result = await checkAndUpdateCooldown(uid(), 'help');
      assert.deepStrictEqual(result, { ok: true });
    });

    it('returns cooldown info on rapid successive calls', async () => {
      const id = uid();
      await checkAndUpdateCooldown(id, 'help');
      const result = await checkAndUpdateCooldown(id, 'help');
      assert.strictEqual(result.cooldown, true);
      assert.ok('remaining' in result);
      assert.ok('cooldownUntil' in result);
    });

    it('allows different commands for the same user', async () => {
      const id = uid();
      const r1 = await checkAndUpdateCooldown(id, 'help');
      const r2 = await checkAndUpdateCooldown(id, 'menu');
      assert.deepStrictEqual(r1, { ok: true });
      assert.deepStrictEqual(r2, { ok: true });
    });
  });

  describe('banUser / unbanUser / getUserBanStatus', () => {
    it('executes without throwing', async () => {
      const id = uid();
      await checkAndUpdateCooldown(id, 'help');
      await assert.doesNotReject(() => banUser(id, 'spam', 60000));
      const status = getUserBanStatus(id);
      assert.strictEqual(typeof status, 'object');
    });

    it('unbanUser does not throw', async () => {
      const id = uid();
      await assert.doesNotReject(() => unbanUser(id));
    });
  });

  describe('getUserStats', () => {
    it('returns stats for a user who has used commands', async () => {
      const id = uid();
      await checkAndUpdateCooldown(id, 'ping');
      const stats = await getUserStats(id);
      assert.strictEqual(stats.jid, id);
      assert.ok('firstSeen' in stats);
      assert.ok('flags' in stats);
    });
  });

  describe('clearUserCooldowns', () => {
    it('clears cooldown state for a user', async () => {
      const id = uid();
      await checkAndUpdateCooldown(id, 'help');
      await checkAndUpdateCooldown(id, 'help');
      await clearUserCooldowns(id);
      const result = await checkAndUpdateCooldown(id, 'help');
      assert.deepStrictEqual(result, { ok: true });
    });
  });

  describe('getGlobalCooldownStats', () => {
    it('returns global statistics object', async () => {
      const stats = await getGlobalCooldownStats();
      assert.strictEqual(typeof stats, 'object');
      assert.ok('totalUsers' in stats);
      assert.ok('totalBanned' in stats);
    });
  });
});
