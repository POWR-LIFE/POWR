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
4. Styled words inside a sentence (the gold word in a headline, a tappable "Log in") use `<Trans>` with named tags: `"Unlock the\n<gold>map.</gold>"` and `<Trans i18nKey="…" components={{ gold: <Text style={…} /> }} />`. **Never name a tag after a void HTML element** (`link`, `br`, `img`, `input`, `hr`, `meta`, `source`…): the parser treats it as empty and the styling silently disappears. Use `action`, `gold`, `strong2` and so on.
5. Counts use plurals: `"points_one": "{{count}} point"`, `"points_other": "{{count}} points"`, then `t('common:points', { count })`. French says "0 point" (singular). i18next handles that.
6. Never call `t()` at module level (outside a component or function). The string would freeze in whatever language was on screen when the file loaded.
7. Dates and numbers: `toLocaleDateString(getFormatLocale(), …)` from `@/lib/i18n` instead of a hard-coded `'en-GB'`. English stays `en-GB`, so English output doesn't change.
8. **English must look identical after a conversion.** A screen moved onto keys should be a no-op for English readers, which is what makes every conversion safe to ship by OTA.

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
- French typography: typographic apostrophe `’` (never `'`), a no-break space (U+00A0) before `?` `!` `:` `;` and inside `« »`. Spanish: opening `¿` and `¡`, quotes `«…»`.
- Avoid gendered forms where a neutral phrasing exists ("Tu as déjà un compte ?" rather than "Déjà inscrit ?"; "Hola de nuevo" rather than "Bienvenido").
- Copy that imitates an OS dialog (the permission mocks) mirrors Apple's and Google's own localized wording, which uses "vous" in French. That's their voice, not ours.

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
| gym session | séance | sesión | |
| wearable | montre connectée | wearable | English also says "watch": that's *montre* / *reloj* |
| Apple Health (the iOS app) | l’app Santé | la app Salud | Keep "Apple Health" where it's a provider name in a list |
| Health Connect | Santé Connect | Health Connect | Google's own localized names |
| primary source | source principale | fuente principal | |
| est. (estimated points) | env. | aprox. | |
| location | localisation (the feature) / position (the OS's word) | ubicación | |
| partner venue | lieu partenaire | centro asociado | |
| log (record by hand) | saisir | registrar | |
| steps | pas | pasos | |
| sleep | sommeil | sueño | |
| verified | vérifié | verificado | |
| friend | ami / amie | amigo / amiga | Avoid gendered forms where a neutral phrasing exists |
| invite code | code d'invitation | código de invitación | |
| Settings (POWR's own screen) | Paramètres | Ajustes | |
| Settings (the phone's app) | Réglages (iOS) / Paramètres (Android) | Ajustes | Say "dans les réglages" when the copy covers both platforms |
| phone | téléphone | móvil | |
| email | e-mail | correo (electrónico) | |
| password | mot de passe | contraseña | |
| log in | se connecter (button: Connecte-toi) | iniciar sesión (button: Inicia sesión) | Toggle pills: Connexion / Inscription, Iniciar sesión / Registrarse |
| sign up | s’inscrire (button: Inscris-toi) | registrarse (button: Regístrate) | |
| Forgot password? | Mot de passe oublié ? | ¿Has olvidado tu contraseña? | |
| username | nom d’utilisateur (placeholder « pseudo ») | nombre de usuario (placeholder "usuario") | |
| display name | nom affiché | nombre visible | |
| optional | facultatif | opcional | |
| photo library | photothèque | fototeca | Apple's terms |
| Not now | Plus tard | Ahora no | |
| Done | Terminé | Hecho | |
| Got it | Compris | Vale | |
| Let's go | C’est parti | ¡Vamos! | |
| achievements | succès | logros | |
| LVL (level badge) | NIV. | NIV. | |
| level up | NOUVEAU NIVEAU | NUEVO NIVEL | Badge wording |
| level names ("Touching Grass"…) | translated as jokes | translated as jokes | Keys under points:levels.*; the reviewer signs off each one |
| tier (Recruit / Athlete / Elite / Legend) | RECRUE / ATHLÈTE / ÉLITE / LÉGENDE | RECLUTA / ATLETA / ÉLITE / LEYENDA | |
| balance | solde | saldo | |
| daily cap | plafond quotidien | límite diario | |
| vest / matured (Vault) | mûrir / arrivé à terme | madurar / madurado | Vault is masculine: le Vault, el Vault |
| Activity Focus | Activités phares | Actividades principales | |
| Help Centre | Centre d’aide | Centro de ayuda | |
| Support (settings section) | Assistance | Ayuda | "soporte" in Spanish body text |
| Together (challenge feature) | Ensemble | En equipo | |
| Pacer | lièvre | liebre | The running term |
| open board | tableau ouvert | tablón abierto | |
| friend request | demande d’ami | solicitud de amistad | |
| Gym (activity chip) | Salle | Gym | Full name elsewhere: Salle de sport / Gimnasio |
| Running (activity chip) | Course | Correr | Full name: Course à pied |
| Strength training | Musculation | Fuerza | |
| Mountain biking | VTT | BTT | |
| Hiking | Randonnée | Senderismo | |
| Tabs: Home / Progress / League / Spend / Discover | Accueil / Progrès / Ligue / Échanger / Découvrir | Inicio / Progreso / Liga / Canjear / Descubrir | |
| readiness | forme | forma | |
| resting heart rate / HRV | FC au repos / VFC | FC en reposo / VFC | |
| sleep stages: deep / REM / light | profond / paradoxal / léger | profundo / REM / ligero | |
| training load | charge d’entraînement | carga de entreno | |
| pace / climb / laps | allure / dénivelé / longueurs | ritmo / desnivel / largos | |
| streak rescue | sauvetage | rescate | |
| weekly recap | bilan | resumen | |
| Get Directions | Itinéraire | Cómo llegar | Google Maps' own wording |
| Open now / Closed | Ouvert / Fermé | Abierto / Cerrado | |
| LIVE NOW | EN DIRECT | EN DIRECTO | |
| ticket (event entry) | billet | entrada | |
| start line | ligne de départ | línea de salida | |
| Up for grabs | À prendre | En juego | |
| champion (podium) | N° 1 | N.º 1 | Gender-neutral |
| signup (affiliate) | inscription | registro | |
| Saved to your Photos | Image enregistrée dans Photos | Imagen guardada en Fotos | |
| Android notification channels: General / Streak Alerts / Rewards | Général / Alertes de série / Récompenses | General / Alertas de racha / Recompensas | |
| times of day | 24-hour "22:30" | 24-hour "22:30" | English keeps "10:30pm" |
| Every move counts. | Chaque mouvement compte. | Cada movimiento cuenta. | Email tagline |
| Unsubscribe / Privacy Policy | Se désabonner / Politique de confidentialité | Darse de baja / Política de privacidad | Email footer |
| rank #N | n° N | n.º N | |
| Doors open | Portes ouvertes | Las puertas abren | |
| POWR drop (Vault grant) | Cadeau POWR | Regalo POWR | |
| clean slate | page blanche | borrón y cuenta nueva | |

Add to this table whenever a new term comes up, so every screen uses the same word.

## Server: pushes and emails

Text the server sends lives in `supabase/functions/_shared/i18n/` (edge functions can't import this folder):

- `push/<lang>.ts` and `email/<lang>.ts`: the catalogs, same `{{x}}` and `_one`/`_other` conventions as the app.
- `levels.ts`: level names, which a test keeps identical to the app's.
- `languages.ts`: `SERVER_LANGUAGES`, the languages pushes and emails actually go out in. Today that's only English, so the server code changes nothing for anyone until a language is added there.

Each recipient's language comes from `profiles.language` (the app keeps it current). `languagesFor()` reads it for a whole batch, and doesn't touch the database at all while English is the only live language. `__tests__/serverI18n.test.ts` checks the catalogs the same way the app's are checked, plus that every `tPush`/`tEmail` key used in the code exists.

**Reviewing emails before going live:** `POST https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/email-previews?lang=fr` (or `es`) with `{"key":"powr-email-previews","to":"<allowlisted address>"}` sends every member email in that language (see `docs/email-previews.md`).

**Going live with a language on the server:**
1. A native speaker reviews `push/<lang>.ts`, `email/<lang>.ts` and the email previews.
2. The callers that still send English fragments are fixed (see the server PR: vault bonus reason, wearable activity label, shared-challenge fallbacks).
3. Add the language to `SERVER_LANGUAGES`.
4. Redeploy every function that bundles `_shared/i18n`: send-push-notification, gym-visit-beacon, dispatch-daily-nudges, streak-rescue-sweep, send-welcome-email, send-weekly-summary, send-level-up-email, send-reengagement-email, send-redemption-receipt, email-previews. Each edge function freezes its own copy of `_shared` at deploy time.

Admin-written text stays as written: broadcasts, and the notification-copy overrides in the admin panel. Those overrides apply to English readers only; everyone else gets the translated default.

## Native (next build only)

The iOS permission prompts (location, Health, camera, photos) and the list of languages the phone shows for POWR are baked into the app binary, so they can't be loaded from these files at runtime. They change the app fingerprint, so they're added **only when a native build is being cut**. Until then the app runs in French or Spanish while those few system prompts stay English.
