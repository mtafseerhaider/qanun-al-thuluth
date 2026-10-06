import { DevSettings, I18nManager } from 'react-native';

import { isRtlLocale } from '@shared';

import { applyDirection, logicalTextAlign, needsDirectionChange, reloadApp } from '../rtl';

describe('RTL helpers', () => {
  const state = { isRTL: false };

  beforeEach(() => {
    state.isRTL = false;
    Object.defineProperty(I18nManager, 'isRTL', { get: () => state.isRTL, configurable: true });
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    jest.spyOn(I18nManager, 'swapLeftAndRightInRTL').mockImplementation(() => undefined);
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation((v: boolean) => {
      state.isRTL = v;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('treats ur as RTL and en as LTR', () => {
    expect(isRtlLocale('ur')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
  });

  it('detects when the direction must flip', () => {
    expect(needsDirectionChange('ur', false)).toBe(true);
    expect(needsDirectionChange('ur', true)).toBe(false);
    expect(needsDirectionChange('en', true)).toBe(true);
    expect(needsDirectionChange('en', false)).toBe(false);
  });

  it('forces RTL and asks for a reload when switching to Urdu', () => {
    expect(applyDirection('ur')).toBe(true);
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  });

  it('does not reload when the direction already matches', () => {
    state.isRTL = true;
    expect(applyDirection('ur')).toBe(false);
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
  });

  it('switches back to LTR for English', () => {
    state.isRTL = true;
    expect(applyDirection('en')).toBe(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
  });

  it('reloads with DevSettings in development', async () => {
    const reload = jest.spyOn(DevSettings, 'reload').mockImplementation(() => undefined);
    await reloadApp();
    expect(reload).toHaveBeenCalled();
  });

  it('maps logical alignment to RN values', () => {
    expect(logicalTextAlign('start')).toBe('auto');
    expect(logicalTextAlign(undefined)).toBe('auto');
    expect(logicalTextAlign('center')).toBe('center');
    expect(logicalTextAlign('end')).toBe('right');
  });
});
