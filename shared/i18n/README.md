# Translations

One place for every language POWR speaks. The app reads `shared/i18n/<lang>/app/*.json`; the portals will read `shared/i18n/<lang>/portal.json` once #513 lands.

| Language | App status |
|---|---|
| English (`en`) | Live, the source for every other language |
| French (`fr`) | Draft, translators only |
| Spanish (`es`) | Draft, translators only |

## The one rule

A language goes live on a surface only when **every screen of that surface reads its text from these files** and **the language covers every English string, reviewed by a native speaker**. Half-translated is worse than English throughout. Until then it sits in `APP_DRAFT_LANGUAGES` (`index.ts`), and only someone with the translation preview on can see it.

Going live = move the code from `APP_DRAFT_LANGUAGES` to `APP_LANGUAGES`. `__tests__/appI18n.test.ts` refuses if a single English string is missing.

## Seeing a draft on a phone

Settings → long-press the `POWR · v1.6.0 …` line at the bottom → **Translation preview on**. A **Language** row appears in Settings with the drafts listed. Long-press again to turn it off.

## Adding text to a screen (developers)

1. Put the English string in the right namespace file, `shared/i18n/en/app/<namespace>.json`, grouped by screen or feature:
   ```json
   { "language": { "title": "Language" } }
   ```
2. Use it with the key written **in full, including the namespace**:
   ```tsx
   const { t } = useTranslation();
   <Text>{t('settings:language.title')}</Text>
   ```
   The test scans the source for every `'namespace:key'` and fails if English lacks it, and fails on any `t('…')` without a namespace.
3. Values go in as placeholders, never glued together: `t('home:steps.left', { count })` with `"{{count}} steps to go"`. Word order differs between languages, so `'You have ' + n + ' points'` can't be translated.
4. Counts use plurals: `"points_one": "{{count}} point"`, `"points_other": "{{count}} points"`, then `t('common:points', { count })`. French says "0 point" (singular). i18next handles that.
5. Never call `t()` at module level (outside a component or function). The string would freeze in whatever language was on screen when the file loaded.
6. Dates and numbers: `toLocaleDateString(getFormatLocale(), …)` from `@/lib/i18n` instead of a hard-coded `'en-GB'`. English stays `en-GB`, so English output doesn't change.
7. **English must look identical after a conversion.** A screen moved onto keys should be a no-op for English readers, which is what makes every conversion safe to ship by OTA.

A new namespace means a new file per language **and** one import per language in `app.ts`. The test fails if a file isn't registered.

## Adding a language

1. Copy `en/app/` to `<lang>/app/` and translate the values (never the keys).
2. Register the files in `app.ts`, add the code to `APP_DRAFT_LANGUAGES`, and add its own name to `LANGUAGE_NAMES` in `index.ts`.
3. Native strings (iOS permission prompts) ride the next native build. See *Native* below.
4. A native speaker reviews it in the preview. Only then does it move to `APP_LANGUAGES`.

Untranslated strings can be left as `""`. They show in English rather than blank.

## Tone

- **French: "tu".** POWR talks like a training partner, not a bank. Use "tu" everywhere, including errors and legal-ish notices inside the app (the Terms and Privacy pages themselves get a proper legal translation, not this).
- **Spanish: "tú", Spain Spanish.** Our Spanish members are in Spain. Use *móvil* (not *celular*), *vale* where natural, and Spain's iOS and Android terms (*Ajustes*).
- Short beats literal. French runs 15 to 30% longer than English. If a button or chip would wrap, find the shorter phrasing rather than shrinking the font.
- Keep the energy of the English, but don't translate idioms word for word. Find what a French or Spanish speaker would actually say.
- Numbers, dates and currency come from `Intl`. Don't hand-format "1 000" or "1.000" in a string.

## Glossary

Terms that stay in English are product names. Use them exactly as written, with no article changes beyond what grammar needs.

| English | French | Spanish | Notes |
|---|---|---|---|
| POWR | POWR | POWR | Brand and the points currency ("20 POWR"). Never translated, always caps. |
| POWR ID | POWR ID | POWR ID | |
| Gym Clash | Gym Clash | Gym Clash | Product name |
| Clash Night | Clash Night | Clash Night | Product name |
| Vault | Vault | Vault | Feature name |
| The Drop | The Drop | The Drop | Feature name |
| points | points | puntos | "20 POWR points" → "20 points POWR" / "20 puntos POWR" |
| level | niveau | nivel | |
| streak | série | racha | "7-day streak" → "série de 7 jours" / "racha de 7 días" |
| reward | récompense | recompensa | |
| redeem | échanger | canjear | |
| wallet | portefeuille | cartera | |
| challenge | défi | reto | |
| leaderboard | classement | clasificación | |
| live event | événement live | evento en directo | |
| gym | salle de sport (or "salle") | gimnasio (or "gym") | |
| partner gym | salle partenaire | gimnasio asociado | |
| check-in | check-in | check-in | Understood in both. Verb: "faire un check-in" / "hacer check-in" |
| workout | séance | entreno | Spain: *entreno* is natural, *entrenamiento* when formal |
| steps | pas | pasos | |
| sleep | sommeil | sueño | |
| verified | vérifié | verificado | |
| friend | ami / amie | amigo / amiga | Avoid gendered forms where a neutral phrasing exists |
| invite code | code d'invitation | código de invitación | |
| Settings | Paramètres | Ajustes | |
| phone | téléphone | móvil | |

Add to this table whenever a new term comes up, so every screen uses the same word.

## Native (next build only)

The iOS permission prompts (location, Health, camera, photos) and the list of languages the phone shows for POWR are baked into the app binary, so they can't be loaded from these files at runtime. They change the app fingerprint, so they're added **only when a native build is being cut**. Until then the app runs in French or Spanish while those few system prompts stay English.
