import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  logFailure,
  getFailureSummary,
  formatFailureReport,
  clearOldFailures,
} from '../lib/failureTracker.js';

describe('failureTracker', () => {
  describe('logFailure', () => {
    it('accepts an error without throwing', () => {
      assert.doesNotThrow(() => {
        logFailure('sample.js', 'runtime', new Error('boom'), { cmd: 'test' });
      });
    });
  });

  describe('getFailureSummary', () => {
    it('returns an object with expected shape', () => {
      logFailure('summarytest.js', 'load', new Error('fail'), {});
      const summary = getFailureSummary();
      assert.strictEqual(typeof summary, 'object');
      assert.ok('total' in summary);
      assert.ok('byType' in summary);
      assert.ok('mostRecent' in summary);
    });

    it('total is a non-negative number', () => {
      const summary = getFailureSummary();
      assert.strictEqual(typeof summary.total, 'number');
      assert.ok(summary.total >= 0);
    });
  });

  describe('formatFailureReport', () => {
    it('returns a non-empty string', () => {
      logFailure('reporttest.js', 'syntax', new Error('bad syntax'), {});
      const report = formatFailureReport();
      assert.strictEqual(typeof report, 'string');
      assert.ok(report.length > 0);
    });

    it('includes failure-related content', () => {
      const report = formatFailureReport();
      assert.ok(
        report.toLowerCase().includes('fail') || report.toLowerCase().includes('report'),
        'report should mention failures',
      );
    });
  });

  describe('clearOldFailures', () => {
    it('runs without throwing', () => {
      assert.doesNotThrow(() => clearOldFailures());
    });
  });
});
