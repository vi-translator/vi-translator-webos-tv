# LG Content Store: what to submit

Submitted through **LG Seller Lounge** (https://seller.lgappstv.com), as a *Web app* for webOS TV.

- **Text, 33 languages:** `listing/<code>.json`, with `title`, `short` (≤ 80), `description` (≤ 4000) and
  `release_notes`. Paste each language into the matching language of the app's information page.
- **Images:** `images/`
  - `icon-80.png` and `icon-130.png`, the same files as the app's `icon.png` and `largeIcon.png`
  - `icon-400.png` and `icon-512.png`, if the form asks for a larger icon
  - `screenshots/*.png` 1920×1080
- **The app:** the `.ipk` from the GitHub Release (`vi-translator-webos-tv-X.Y.Z.ipk`).

Check the current image sizes in Seller Lounge when you submit; LG changes them between years.

## Answers

| Field | Answer |
| --- | --- |
| Category | Utility (or Lifestyle) |
| Price | Free |
| Supported webOS | 5.0 and later (2020 TVs and newer) |
| Privacy policy | https://vitranslator.app/privacy/ |
| Age rating | All ages |
| Countries | Start with the ones you can support; each country is tested separately |

## Know before submitting

- The app draws over other inputs with a window kind LG doesn't document (`"defaultWindowType": "overlay"`).
  LG's QA may question or reject it. Explain in the test notes that the overlay is the app's purpose
  and that it never takes the remote while hidden.
- Test it on a real LG TV (webOS 5 or newer) with the real PC app before submitting.

## Test notes for LG QA

> VI Translator for webOS shows translated subtitles over the TV picture, for console players. The
> subtitles come from the free VI Translator app on a Windows, macOS or Linux PC on the same network
> (https://github.com/vi-translator/vi-translator-desktop/releases). To test:
> 1. Open the app: it shows a 6-digit code.
> 2. On the PC, start VI Translator, open *Source → Show on a TV → Connect a TV*, type the code, press *Connect*.
> 3. In the PC app pick any source (a capture card, or *Screen* to read the PC's own screen) with English
>    subtitles on screen. Press Back on the TV: the app's screen hides and the translations show over the picture.
> 4. Open the app again from the launcher for *Show on* (one HDMI input or all) and *Disconnect*.
> A video of the whole flow: <add a link to an unlisted video>.
> No account or login is needed.
