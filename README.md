# Daily Micro-Habits

A single-user iPhone app for small daily learning and reflection tasks: word of the day,
spaced-repetition review, science and technology concept of the day, Latin American Spanish
phrases, on-this-day history, morning top-3, evening review and a journal.

The app is installed by sideloading with SideStore on a free Apple ID; there is no App Store build.

## Repository layout

| Path | Contents |
| --- | --- |
| `mobile/` | Expo (React Native) app. Currently the **M0 pipeline test app**. |
| `content/` | Bundled content: words (A1), concepts (A3), Spanish phrases (A4), on-this-day (A5). |
| `schemas/` | JSON Schemas for each content module. |
| `tools/` | `validate_content.py` (schema + semantic checks), `balance_answer_keys.py`. |
| `.github/workflows/` | Unsigned iOS build (macOS runner) and content validation. |

## Building

Push a tag (`git tag v0.0.2 && git push origin v0.0.2`) or run **Build iOS (unsigned .ipa for SideStore)**
from the Actions tab. Tag builds publish the `.ipa` as a GitHub Release asset; download it on the
iPhone and open it in SideStore, which signs it.

Data persists across re-signs and updates only if the **bundle ID**
(`com.darrendixon.dailymicrohabits`) and the **signing Apple ID** never change.

## Content validation

```sh
pip install jsonschema
python -I tools/validate_content.py content/*.json
```

No personal data, journal content or API keys belong in this repository.
