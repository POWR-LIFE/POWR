import { FALLBACK_LANGUAGE, parseLocaleTag, pickLocale } from '../shared/locale';

const ENGLISH = { tag: FALLBACK_LANGUAGE, language: FALLBACK_LANGUAGE, region: null, textDirection: 'ltr' };

describe('parseLocaleTag', () => {
  it('splits a plain tag into language and region', () => {
    expect(parseLocaleTag('es-ES')).toEqual({ tag: 'es-ES', language: 'es', region: 'ES', textDirection: 'ltr' });
  });

  it('keeps script subtags in the tag but reports the bare language', () => {
    expect(parseLocaleTag('zh-Hant-TW')).toMatchObject({ tag: 'zh-Hant-TW', language: 'zh', region: 'TW' });
  });

  it('normalises case and Android-style underscores', () => {
    expect(parseLocaleTag(' FR_ca ')).toEqual({ tag: 'FR-ca', language: 'fr', region: 'CA', textDirection: 'ltr' });
  });

  it('leaves numeric regions out rather than guessing a country', () => {
    expect(parseLocaleTag('es-419')).toMatchObject({ language: 'es', region: null });
  });

  it('knows right-to-left languages, and lets an explicit script override them', () => {
    expect(parseLocaleTag('ar-AE').textDirection).toBe('rtl');
    expect(parseLocaleTag('he').textDirection).toBe('rtl');
    expect(parseLocaleTag('az-Arab').textDirection).toBe('rtl');
    expect(parseLocaleTag('ku-Latn').textDirection).toBe('ltr');
    expect(parseLocaleTag('en-GB').textDirection).toBe('ltr');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a blank string', '   '],
    ['a private-use tag', 'x-private'],
    ['a non-string', 42 as unknown as string],
  ])('falls back to English on %s', (_label, raw) => {
    expect(parseLocaleTag(raw)).toEqual(ENGLISH);
  });
});

describe('pickLocale', () => {
  it('takes the first preference', () => {
    expect(pickLocale(['pt-BR', 'en-GB']).language).toBe('pt');
  });

  it('skips junk entries instead of falling back to English', () => {
    expect(pickLocale(['', 'x-private', 'de-DE']).language).toBe('de');
  });

  it('falls back to English when nothing is usable', () => {
    expect(pickLocale([])).toEqual(ENGLISH);
    expect(pickLocale(undefined)).toEqual(ENGLISH);
    expect(pickLocale([null, '  '])).toEqual(ENGLISH);
  });
});
