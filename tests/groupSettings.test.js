import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeGroupSettings,
  getGroupSettings,
  updateGroupSettings,
  deleteGroupSettings,
  isGroupFeatureEnabled,
  toggleGroupFeature,
  setGroupWelcomeText,
  getGroupWelcomeText,
  setGroupGoodbyeText,
  getGroupGoodbyeText,
  getGroupSettingsStats,
  clearAllGroupSettings,
} from '../lib/groupSettings.js';

describe('groupSettings', () => {
  const gid = () => `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  before(async () => {
    await initializeGroupSettings();
  });

  describe('getGroupSettings / updateGroupSettings', () => {
    it('returns defaults for a new group', async () => {
      const settings = await getGroupSettings(gid());
      assert.strictEqual(typeof settings, 'object');
      assert.ok('welcomeMessage' in settings);
    });

    it('merges custom settings onto defaults', async () => {
      const id = gid();
      await updateGroupSettings(id, { antilink: true, customField: 'test' });
      const settings = await getGroupSettings(id);
      assert.strictEqual(settings.antilink, true);
      assert.strictEqual(settings.customField, 'test');
    });
  });

  describe('isGroupFeatureEnabled / toggleGroupFeature', () => {
    it('toggles a feature on and off', async () => {
      const id = gid();
      await updateGroupSettings(id, { antilink: false });

      const before = await isGroupFeatureEnabled(id, 'antilink');
      assert.strictEqual(before, false);

      await toggleGroupFeature(id, 'antilink');
      const after = await isGroupFeatureEnabled(id, 'antilink');
      assert.strictEqual(after, true);

      await toggleGroupFeature(id, 'antilink');
      const toggled = await isGroupFeatureEnabled(id, 'antilink');
      assert.strictEqual(toggled, false);
    });
  });

  describe('welcome / goodbye text', () => {
    it('sets and retrieves welcome text', async () => {
      const id = gid();
      await updateGroupSettings(id, {});
      await setGroupWelcomeText(id, 'Hello {user}!');
      const text = await getGroupWelcomeText(id);
      assert.strictEqual(text, 'Hello {user}!');
    });

    it('sets and retrieves goodbye text', async () => {
      const id = gid();
      await updateGroupSettings(id, {});
      await setGroupGoodbyeText(id, 'Bye {user}!');
      const text = await getGroupGoodbyeText(id);
      assert.strictEqual(text, 'Bye {user}!');
    });
  });

  describe('deleteGroupSettings', () => {
    it('removes custom settings so defaults return', async () => {
      const id = gid();
      await updateGroupSettings(id, { customVal: 42 });
      await deleteGroupSettings(id);
      const settings = await getGroupSettings(id);
      assert.strictEqual(settings.customVal, undefined);
    });
  });

  describe('getGroupSettingsStats', () => {
    it('returns stats with expected keys', async () => {
      const stats = await getGroupSettingsStats();
      assert.ok('totalGroups' in stats);
      assert.ok('cacheSize' in stats);
    });
  });

  describe('clearAllGroupSettings', () => {
    it('resets all groups so stats reflect empty state', async () => {
      const id = gid();
      await updateGroupSettings(id, { test: true });
      await clearAllGroupSettings();
      const stats = await getGroupSettingsStats();
      assert.strictEqual(stats.totalGroups, 0);
    });
  });
});
