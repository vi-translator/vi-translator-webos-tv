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
3. This app shows the translations over the TV picture, where they would be on the game picture.
   Only the text crosses your home network, so it shows as fast as on the PC.

Once its screen is hidden, the app never takes the remote: it keeps working the TV and the game
under it.

## Setup

1. **Install the app on the TV** (it isn't in the LG Content Store; see *Install* below).
2. **Open it:** it shows a 6-digit code. Press **Back** to hide the screen if the PC is on another
   input of this TV: it keeps waiting for 10 minutes, with the same code.
3. **On the PC:** in VI Translator, *Source* tab, *Show on a TV*, *Connect a TV*. Type the code and
   press *Connect*. Sharing on the home network is turned on if it was off.
4. **Press Back** to hide the app's screen, and switch to the console's input. The translations
   show over it.

Opened again from the launcher, the app shows the connection and two buttons:

- **Show on:** a list of all inputs, or one HDMI input only (the console's): the translations then
  hide on other inputs and apps. Offered only on TVs that tell apps which input is on screen;
  elsewhere the translations show everywhere.
- **Disconnect:** the TV forgets the PC and shows a new code. Removing the TV in VI Translator on
  the PC does the same.

On both screens, the 🌐 button in the top corner picks the app's language: the TV's own, or any of
the 33 languages of VI Translator on the PC.

The app finds the PC again if the router gives it a new address.

### What's different from the Android TV app

webOS has no official way for an app to draw over another input. This app uses a window kind that
LG doesn't document (`"defaultWindowType": "overlay"`), which other webOS developers found works
from webOS 5. So:

- **Open it again after the TV turns on:** webOS doesn't let a normal app start by itself.
- **The Home button closes it** (webOS closes overlay windows when the home screen opens). Open it
  again from the launcher; it stays connected.
- **webOS 4 and older can't run it:** VI Translator's TV page needs a newer web engine than they
  have (Chromium 53 and older).

## Install

The app is installed with LG's Developer Mode (no rooting):

1. Make an account on [webostv.developer.lge.com](https://webostv.developer.lge.com/).
2. On the TV, install **Developer Mode** from the LG Content Store, open it, sign in, turn on
   *Dev Mode Status* (the TV restarts) and turn on *Key Server*.
3. On the PC (Node.js 18 or newer), in this folder:

   ```sh
   npm install
   npx ares-setup-device        # add: the TV's IP address, port 9922, user "prisoner"
   npx ares-novacom --device <name> --getkey   # the passphrase shown in Developer Mode
   npm run install-tv           # builds, installs and opens the app on the default TV
   ```

Developer Mode runs for a limited time: open the Developer Mode app now and then and press
*Extend*, or the TV removes the apps installed with it.

## Tips

- Show the game full screen with no zoom (picture size *Original* or *Just Scan*), so the
  translations land where the PC expects.
- The text style, the language and what is read are all set in VI Translator on the PC.

## Build

Needs Node.js 18 or newer:

```sh
npm install
npm run build        # dist/vi-translator-webos_<version>.ipk (checks the code for webOS 5 first)
npm run dev          # try it in a browser without a TV: http://127.0.0.1:8793/?dev=http://127.0.0.1:8793
npm run inspect      # Chrome DevTools for the app on the TV
```

- `app/`: the web app (the code screen, the connection screen and the overlay).
- `service/`: its background service (Node.js), which waits for the PC on the home network (port
  8792) and asks the PC how it is: a web app can't do either on webOS.
- `tools/strings.mjs` makes `app/js/strings.js` (33 languages) from the Android TV app's
  `strings.xml` files, plus `tools/extra-strings.json` for the strings only this app has.

## Credits

The Changa font is under the SIL Open Font License (`FONT-LICENSE-Changa.txt`).
