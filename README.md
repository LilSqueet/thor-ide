# Thor IDE

An on-device, dual-screen development environment for the **AYN Thor**.
Code editor on one screen, your app running live on the other. No PC needed once it's installed.

Apps are plain HTML / CSS / JS. A project's `index.html` runs on the **top** screen and
`bottom.html` on the **bottom** screen, and the two pages can talk to each other.

## Getting the APK (no tools needed)

1. Create a new GitHub repository (public or private, e.g. `thor-ide`).
2. Upload everything in this folder to it: on the repo page choose **Add file → Upload files**
   and drag the whole folder contents in (including the `.github`, `app` and `keystore` folders), then **Commit**.
3. Open the **Actions** tab. The "Build Thor IDE APK" workflow runs automatically (about 3–5 minutes).
   If Actions asks you to enable workflows for the repo, click the green button and re-run.
4. When it's green, the APK is attached to a release called **latest**:
   `https://github.com/<your-user>/<repo>/releases/download/latest/ThorIDE.apk`
   Open that link in the Thor's browser, install the APK (allow "install unknown apps" for the browser if asked).

Every later push rebuilds and replaces `ThorIDE.apk` on that same link. The app is signed with
the committed keystore, so updates install over the old version without uninstalling.

## Block games (no typing)

A project that contains `game.json` opens in the **Blocks** view: a Construct-style event sheet
you build entirely by tapping (or with the controller). Sprites live on the top or bottom screen,
variables hold numbers, and events read `WHEN <trigger> AND <conditions> DO <actions>`.
Values are picked from a keypad, a variable, a sprite property, a random range, the sticks,
the touch position, or simple math on those. **Run** generates `index.html`, `bottom.html` and
`engine.js` from `game.json`, so the result is still an ordinary dual-screen web page you can
open in Code view. The `dodge` sample is a complete two-screen game.

**Photos, GIFs and videos.** In Sprites, "+ Add sprite → photo / GIF / video…" opens the project's media
or imports from the device (the Android file picker). Imported files are copied into the project's `media/`
folder, so projects stay self-contained. GIFs animate and videos loop muted; the "Play video from start" and
"Pause video" actions control them, and "Set photo / video" swaps a sprite's picture at runtime.

Controller in the editor: D-pad / left stick moves the focus ring, **A** selects, **B** goes back,
**L1 / R1** switch panels (or file tabs), **START** runs, **SELECT** toggles Blocks / Code, **Y** toggles the on-screen keyboard.
In games: A B X Y, L1 R1 L2 R2, D-pad, START, SELECT and both sticks are available as triggers / values.

## Using it

| Button | What it does |
|---|---|
| **▶ Run** | Saves and reloads `index.html` on the other screen. You keep editing. |
| **▶▶ Dual** | Full dual-screen run: `index.html` on top, `bottom.html` on bottom. Tap the floating **◀ Editor** button (or Back) to return. |
| **⇅** | Moves the editor to the other screen. The Android soft keyboard shows on the top (main) screen, so put the editor there when you want to type with it; use **⌨** for the built-in coding keyboard on either screen. |
| **⋮** | New / delete project. Projects live in `Android/data/dev.thor.ide/files/projects/`. |
| **+ files** | Open or create files. Long-press a tab to rename, delete or close. |
| console | `console.log` and errors from both screens, plus a box to run JS inside the preview. |

Files auto-save ~1 s after you stop typing. Ctrl+S saves, Ctrl+Enter runs (with a Bluetooth keyboard).

## Talking between screens

Every page gets a `ThorNative` object:

```js
ThorNative.screen()                 // "top" | "bottom"
ThorNative.isDual()                 // true when the bottom screen is attached
ThorNative.send(JSON.stringify(o))  // deliver o to the OTHER screen
window.onThorMessage = (o) => {}    // receive
```

The `dual` project template includes `thor.js`, a tiny wrapper (`Thor.send({...})`, `Thor.on(fn)`),
and a working demo: a D-pad on the bottom screen moves a ball on the top screen.

## How it works

Pure Android framework code, no dependencies: the Activity owns the top screen, a `Presentation`
on the first presentation-category display owns the bottom screen, and each hosts one `WebView`.
If no second display is found (another device, or the bottom screen disabled in settings), the
editor and preview stack on the single screen instead.

Source layout:

- `app/src/main/java/dev/thor/ide/MainActivity.java` – screens, roles, JS bridges
- `app/src/main/java/dev/thor/ide/ProjectStore.java` – project/file storage
- `app/src/main/assets/editor/index.html` – the editor UI (code view, tabs, console)
- `app/src/main/assets/editor/blocks.js` – the block / event-sheet editor
- `app/src/main/assets/editor/nav.js` – controller navigation of the editor
- `app/src/main/assets/engine/engine.js` – runtime for block games (sprites, events, touch, controller, two-screen sync)
- `tools/build-simulator.py` → `sim/thor-ide-simulator.html` – browser simulator of the whole thing
- `app/src/main/assets/templates/` – new-project templates
