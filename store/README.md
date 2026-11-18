# Distribution: outside the LG Content Store

The app is **not** in the LG Content Store. LG Seller Lounge rejects the package at upload with
"appinfo.json is not suitable - defaultWindowType": the store doesn't allow
`"defaultWindowType": "overlay"`, and without it the app can't draw over the console's HDMI input,
which is its purpose. (Tried 2026-11-18 with 1.0.0; a draft with App ID `app.vitranslator.tv` was
started in Seller Lounge and left unsubmitted.)

So the app is installed from its GitHub Release (`vi-translator-webos-tv-X.Y.Z.ipk`) in one of these
ways:

- **Developer Mode** (any webOS 5+ TV, no rooting): the steps in the main README's *Install*. The
  Developer Mode session expires and has to be extended in the Developer Mode app, or the TV removes
  the app.
- **Homebrew Channel**, on TVs that have it: install the `.ipk` with it. A listing in the community
  repository (https://github.com/webosbrew/apps-repo) would let people install and update it from the
  Homebrew Channel itself.

## Kept from the store attempt

`listing/<code>.json` (title, short text, description and release notes in 33 languages) and
`images/` (icons and 1920×1080 screenshots) are still useful for the Homebrew Channel listing and for
the website.
