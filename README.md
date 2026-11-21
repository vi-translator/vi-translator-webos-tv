<p align="center">
  <img src="app/logo.png" alt="VI Translator logo" width="160" />
</p>

<h1 align="center">VI Translator - webOS</h1>

<p align="center">VI Translator's live subtitles on your LG webOS TV, over the game from your console.</p>

---

## What it does

Shows VI Translator's translations on your LG TV, over the game from your console's HDMI input. It
needs an LG TV with webOS 5.0 or newer (2020 models and later), with the console plugged into the TV.

## How it works

1. The console goes into a capture card with passthrough, and the card's passthrough goes into the
   TV, so the game reaches the TV with no delay.
2. VI Translator on the PC reads the subtitles from the capture card and translates them.
3. This app shows the console's HDMI input itself, full screen, with the translations over it
   where they would be on the game picture. Only the text crosses your home network, so it shows
   as fast as on the PC.

Or with the VI Translator phone app instead of the PC: the phone plays the PS5 or the Xbox over
Remote Play (no capture card) and reads the subtitles there, and this app shows the translations
on the TV the same way.

While the game plays, the app keeps the TV awake: the game's picture inside an app doesn't count as
"playing" for webOS, so the TV would otherwise start its screen saver after a few minutes without a
remote key.

## Setup

1. **Install the app on the TV** (it isn't in the LG Content Store; see *Install* below, the
   easiest way is webOS Dev Manager).
2. **Open it:** it shows a 6-digit code. Press **Back** to hide the screen if the PC is on another
   input of this TV: it keeps waiting for 10 minutes, with the same code.
3. **On the PC or the phone:** in VI Translator, *Show on* tab, *Connect a TV*. Type the code and
   press *Connect*. Sharing on the home network is turned on if it was off.
4. **Play on…** → the console's HDMI input. The game shows in the app with the translations over
   it, the app's screen hidden. The app remembers the input: next time it opens straight on the
   game.

Keep the app open while you play: switching inputs with the remote's **Source** button, or another
app, takes the game out of it. Turn off **SIMPLINK (HDMI-CEC)** in the TV's settings and HDMI-CEC
on the console, so the TV doesn't switch inputs by itself when the console wakes up. **Back** (or
**OK**) shows the app's screen over the game, and Back hides it again.

Opened again from the launcher, the app shows the connection and three buttons:

- **Play on…:** HDMI 1 to 4 (or the TV's own list of inputs): shows that input in the app with the
  translations over it. If no picture comes within a few seconds, the screen says so.
- **Disconnect:** the TV forgets the PC (or phone) and shows a new code. Removing the TV in VI
  Translator on the PC or phone does the same.

On both screens, the 🌐 button in the top corner picks the app's language: the TV's own, or any of
the 33 languages of VI Translator on the PC.

The app finds the PC or phone again if the router gives it a new address.

### What's different from the Android TV app

- **The game plays inside the app** (webOS's way of showing an HDMI input in an app), instead of
  the app drawing over the TV's own input: webOS pauses or closes an app drawn over another one
  after a while, which cut the translations off after a few minutes in versions before 1.1.0.
- **Open it again after the TV turns on:** webOS doesn't let a normal app start by itself. It
  starts on the game's input straight away.
- **webOS 4 and older can't run it:** VI Translator's TV page needs a newer web engine than they
  have (Chromium 53 and older).

## Install

The app is installed with LG's Developer Mode (no rooting):

1. Make a free account on [webostv.developer.lge.com](https://webostv.developer.lge.com/).
2. On the TV, install **Developer Mode** from the LG Content Store, open it, sign in, turn on
   *Dev Mode Status* (the TV restarts) and turn on *Key Server*.
3. Install the app from the PC, either way:

### With webOS Dev Manager (no command line)

1. Install [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest)
   (free; Windows, macOS, Linux).
2. *Add Device*: the TV's IP address and the passphrase shown in the Developer Mode app.
3. Download `vi-translator-webos-tv-X.Y.Z.ipk` from the
   [latest release](https://github.com/vi-translator/vi-translator-webos-tv/releases/latest) and
   install it on the TV with webOS Dev Manager.

### From this folder (to build it yourself)

With Node.js 18 or newer:

```sh
npm install
npx ares-setup-device        # add: the TV's IP address, port 9922, user "prisoner"
npx ares-novacom --device <name> --getkey   # the passphrase shown in Developer Mode
npm run install-tv           # builds, installs and opens the app on the default TV
```

Developer Mode runs for a limited time: open the Developer Mode app now and then and press
*Extend*, or the TV removes the apps installed with it. webOS Dev Manager can also renew it on a
schedule.

## Tips

- Show the game full screen with no zoom (picture size *Original* or *Just Scan*), so the
  translations land where the PC or phone expects.
- The text style, the language and what is read are all set in VI Translator on the PC.

## Build

Needs Node.js 18 or newer:

```sh
npm install
npm run build        # dist/vi-translator-webos-tv-<version>.ipk (checks the code for webOS 5 first)
npm run dev          # try it in a browser without a TV: http://127.0.0.1:8793/?dev=http://127.0.0.1:8793
npm run inspect      # Chrome DevTools for the app on the TV
```

- `app/`: the web app (the code screen, the connection screen, the game's input and the
  translations over it; `js/awake.js` keeps the TV awake while the game plays).
- `service/`: its background service (Node.js), which waits for the PC on the home network (port
  8792) and asks the PC how it is: a web app can't do either on webOS.
- `tools/strings.mjs` makes `app/js/strings.js` (33 languages) from the Android TV app's
  `strings.xml` files, plus `tools/extra-strings.json` for the strings only this app has.

## Release

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`. It checks that the tag looks like
`v1.2.3` and is newer than the latest release. It then sets the version from the tag (in
`app/appinfo.json` and both `package.json` files) and builds `vi-translator-webos-tv-X.Y.Z.ipk`.
Last, it attaches that file to a GitHub Release called "VI Translator for LG webOS TVs X.Y.Z".

```sh
git tag v1.0.0
git push origin v1.0.0
```

No secrets are needed, because Developer Mode installs unsigned packages. To install a released
`.ipk` on a TV that is set up for Developer Mode (see Install):

```sh
npx ares-install vi-translator-webos-tv-1.0.0.ipk
npx ares-launch app.vitranslator.tv
```

## Credits

The Changa font is under the SIL Open Font License (`FONT-LICENSE-Changa.txt`).
