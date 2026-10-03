import { getLocales } from 'expo-localization';

import { FALLBACK_LANGUAGE, getDeviceLanguage, getDeviceLocale } from '@/lib/locale';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(),
  useLocales: jest.fn(),
}));

const mockGetLocales = getLocales as jest.Mock;

function locale(overrides: Record<string, unknown>) {
  return {
    languageTag: 'en-GB',
    languageCode: 'en',
    regionCode: 'GB',
    textDirection: 'ltr',
    ...overrides,
  };
}

describe('getDeviceLocale', () => {
  it('reads the first (most preferred) device locale', () => {
    mockGetLocales.mockReturnValue([
      locale({ languageTag: 'es-ES', languageCode: 'es', regionCode: 'ES' }),
      locale({}),
    ]);
    expect(getDeviceLocale()).toEqual({ tag: 'es-ES', language: 'es', region: 'ES', textDirection: 'ltr' });
    expect(getDeviceLanguage()).toBe('es');
  });

  it('keeps script subtags in the tag but reports the bare language', () => {
    mockGetLocales.mockReturnValue([locale({ languageTag: 'zh-Hant-TW', languageCode: 'zh', regionCode: 'TW' })]);
    expect(getDeviceLocale()).toMatchObject({ tag: 'zh-Hant-TW', language: 'zh', region: 'TW' });
  });

  it('falls back to the tag when languageCode is missing', () => {
    mockGetLocales.mockReturnValue([locale({ languageTag: 'FR-ca', languageCode: null, regionCode: null })]);
    expect(getDeviceLocale()).toMatchObject({ language: 'fr', region: null });
  });

  it('passes right-to-left through', () => {
    mockGetLocales.mockReturnValue([locale({ languageTag: 'ar-AE', languageCode: 'ar', regionCode: 'AE', textDirection: 'rtl' })]);
    expect(getDeviceLocale().textDirection).toBe('rtl');
  });

  it.each([
    ['an empty list', []],
    ['a blank tag', [locale({ languageTag: '  ', languageCode: null })]],
    ['an unparseable language', [locale({ languageTag: 'x-private', languageCode: null })]],
  ])('falls back to English on %s', (_label, locales) => {
    mockGetLocales.mockReturnValue(locales);
    expect(getDeviceLocale()).toEqual({ tag: FALLBACK_LANGUAGE, language: FALLBACK_LANGUAGE, region: null, textDirection: 'ltr' });
  });

  it('never throws when the native call does', () => {
    mockGetLocales.mockImplementation(() => { throw new Error('native module gone'); });
    expect(getDeviceLanguage()).toBe(FALLBACK_LANGUAGE);
  });
});
