# Daily Micro-Habits

A single-user iPhone app for small daily learning and reflection tasks: word of the day,
spaced-repetition review, science and technology concept of the day, Latin American Spanish
phrases, on-this-day history, morning top-3, evening review and a journal.

The app is sideloaded on a free Apple ID (currently with iloader from a Mac; SideStore once its sign-in
issue is fixed); there is no App Store build.

## Repository layout

| Path | Contents |
| --- | --- |
| `mobile/app/` | expo-router screens: tabs (Today, Review, Journal, Stats, Settings), D1, D2, journal editor, passphrase setup, diagnostics. |
| `mobile/src/` | App code: `db/` schema + migrations, `security/` keys and passphrase encryption, `srs/` FSRS scheduling, `settings/`, `backup/`, `daily/` (D1–D3 rules, daily cycle), `notifications/`, `streaks/`, `time/`, `diagnostics/` (on-device tests T1–T13). |
| `mobile/tests/` | Node tests; they run the same diagnostic cases under `node:sqlite` and `node:crypto`. |
| `mobile/tools/` | `generate_fsrs_reference_vectors.ts` (expected FSRS outputs for diagnostic T1). |
| `content/` | Bundled content: words (A1), concepts (A3), Spanish phrases (A4), on-this-day (A5). |
| `schemas/` | JSON Schemas for each content module. |
| `tools/` | `validate_content.py` (schema + semantic checks), `balance_answer_keys.py`. |
| `.github/workflows/` | Unsigned iOS build (macOS runner), mobile tests, lockfile/vector refresh, content validation. |

## Building

1. After changing dependencies, run **Refresh lockfile and FSRS reference vectors** (commits
   `package-lock.json` and `src/srs/fsrs_reference_vectors.json`).
2. **Test mobile app** runs on every push: type-check, unit tests, and diagnostics T1–T13 under Node.
3. Run **Build iOS (unsigned .ipa for sideloading)** from the Actions tab (optionally entering a version).
   Every successful build publishes the `.ipa` as an asset of GitHub Release `v<version>`; install it with
   iloader (Import IPA), over the existing app.

On launch the app runs diagnostics T1–T13 automatically (Settings → Diagnostics).

Data persists across re-signs and updates only if the **bundle ID**
(`com.darrendixon.dailymicrohabits`) and the **signing Apple ID** never change.

## Content validation

```sh
pip install jsonschema
python -I tools/validate_content.py content/*.json
```

No personal data, journal content or API keys belong in this repository.
