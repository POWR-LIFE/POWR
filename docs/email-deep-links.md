# Email CTA → app deep links

Email CTA buttons (welcome "Open POWR", weekly "Start this week", plus reward /
streak / milestone / inactivity emails) all link to **`https://powr.life/app`**.
We never put a raw `powr://` scheme in email HTML — Gmail/Outlook strip it.

Two layers make that URL open the native app:

1. **Universal Links (iOS) / App Links (Android)** — the OS opens the app
   directly, with no prompt, when the app is installed.
2. **Smart-link fallback page** (`landing-page/public/app.html`) — if the app
   isn't installed (or links aren't verified yet), this page sends the user to
   the App Store / Play Store.

## What's already wired

| Piece | File |
| --- | --- |
| Smart-link fallback page | `landing-page/public/app.html` |
| `/app` + `.well-known` routing / headers | `landing-page/vercel.json` |
| iOS AASA | `landing-page/public/.well-known/apple-app-site-association` |
| Android assetlinks | `landing-page/public/.well-known/assetlinks.json` |
| iOS `associatedDomains` | `app.json` → `expo.ios.associatedDomains` |
| Android App Links intent filter (`autoVerify:true`) | `app.json` → `expo.android.intentFilters` |
| In-app route handling for `https://powr.life/app` | `app/+native-intent.tsx` |

Scope is limited to the `/app` path, so `powr.life/`, `/privacy`, `/admin`,
`/partner` etc. keep opening in the browser as normal.

## Real values (filled in 2026-06-20)

- **Apple Team ID**: `CHJQ87VF2S` → AASA appID `CHJQ87VF2S.com.powr.life`.
- **Android Play App Signing SHA-256**:
  `72:E7:40:0E:7F:F5:A6:EA:95:46:FF:7D:1D:66:07:71:2F:C2:B4:72:72:A5:98:6E:D9:AB:FF:F0:5C:C6:79:6A`
  (from Play Console → App signing key certificate).

> Optional: to also verify App Links on **EAS internal/test builds**, add the
> **upload key** SHA-256 (`eas credentials` → Android) as a second entry in the
> `sha256_cert_fingerprints` array. Extra fingerprints are harmless.

## Deploy + rebuild
- **Landing page**: deploy to Vercel (picks up `app.html`, the `/app` rewrite,
  and the `.well-known` files automatically).
- **App**: the `app.json` changes are native, so they need a new **EAS build**
  and a **store release** (associatedDomains entitlement on iOS; autoVerify
  intent filter on Android). Links won't open the app until that build ships.

> ⚠️ Order matters: deploy the landing page (so the `.well-known` files are live)
> **before** the store build is reviewed/released — iOS fetches the AASA at
> install time and Android verifies App Links on update, so the files should
> already be reachable when the new build lands on devices.

## How to verify after deploy / release

```bash
# AASA must be JSON, 200, no redirect:
curl -sI https://powr.life/.well-known/apple-app-site-association   # 200 + application/json
curl -s  https://powr.life/.well-known/assetlinks.json | jq .

# Android App Links verification status (on a device/emulator with the app):
adb shell pm get-app-links com.powr.life
# Force re-verify if needed:
adb shell pm verify-app-links --re-verify com.powr.life
```

iOS: open `https://powr.life/app` from Notes/Mail (not pasted in Safari's bar) →
the installed app should open straight to home. Apple may take a little while to
fetch the AASA after first install.
