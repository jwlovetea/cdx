import { beforeEach, describe, expect, it } from 'vitest';
import { configValues, resetConfiguration } from './__mocks__/vscode';
import { getCacheMaxBytes, isAutoOpenEnabled } from '../settings';

describe('settings', () => {
  beforeEach(() => {
    resetConfiguration();
  });

  describe('isAutoOpenEnabled', () => {
    it('defaults to true', () => {
      expect(isAutoOpenEnabled()).toBe(true);
    });

    it('reads cdx.autoOpen', () => {
      configValues.autoOpen = false;
      expect(isAutoOpenEnabled()).toBe(false);
    });
  });

  describe('getCacheMaxBytes', () => {
    it('treats 0 as unlimited', () => {
      configValues.cacheMaxMb = 0;
      expect(getCacheMaxBytes()).toBe(0);
    });

    it('converts megabytes to bytes', () => {
      configValues.cacheMaxMb = 2;
      expect(getCacheMaxBytes()).toBe(2 * 1024 * 1024);
    });

    it('treats negative or invalid values as unlimited', () => {
      configValues.cacheMaxMb = -1;
      expect(getCacheMaxBytes()).toBe(0);
      configValues.cacheMaxMb = Number.NaN;
      expect(getCacheMaxBytes()).toBe(0);
    });
  });
});
