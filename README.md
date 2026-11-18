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

## Adventures (no typing needed)

A project that contains `adventure.json` opens in the **Blocks** view, a Scratch-style editor for
point-and-click adventure games:

- **Scenes** have a background (a colour or a photo) and *things* in them (a door, a person, a key)
  that the player taps. Drag things around in the preview; make them hidden at start if they
  should appear later.
- **Blocks** are scripts attached to a scene: *when scene starts*, *when [thing] is tapped*,
  *when [item] is used on [thing]*, *when button [A] is pressed*. Blocks include **say**
  (speech bubble + dialog box), **show picture**, **ask** (choices with their own branches),
  **if / else**, **wait**, **go to scene**, **show / hide / move** a thing, **set / change** a
  variable, **give / take** an item, **beep**, **end game**.
- **Variables** remember numbers; **Items** are the player's inventory.
- **My blocks** are reusable stacks (Scratch's custom blocks): build one once, then put a
  **run [name]** block in any script.

On the Thor the top screen is the scene and the bottom screen is the dialog box, the choices and
the inventory, like a DS adventure game. Run generates `index.html`, `bottom.html` and `adventure.js`.
Text is typed on a built-in keyboard inside the editor, so it works on either screen.

Controller in the editor: D-pad / left stick moves the focus ring, **A** selects, **B** goes back,
**L1 / R1** switch panels, **START** runs, **SELECT** toggles Blocks / Code.
In the game: D-pad moves between things, **A** taps / continues dialog, **L1 / R1** pick an item.

### Export as app

Project menu (⋮) → **Export as app (APK)** turns the current game into its own installable APK,
on the Thor itself: the IDE bundles a small "player" runtime (`player/`), gives it a unique package
name and your app name by patching the binary manifest, drops the project files into `assets/game/`,
JAR-signs it with the bundled hobby key (`ApkExporter.java`, pure Java) and hands it to Android's
installer. A copy also lands in `Download/ThorGames/`. The first export asks you to allow Thor IDE
to install apps. Each exported game gets its own icon and runs on both screens without the IDE.

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
- `app/src/main/assets/editor/adv.js` – the Scratch-style adventure editor
- `app/src/main/assets/editor/nav.js` – controller navigation of the editor
- `app/src/main/assets/engine/adventure.js` – adventure runtime (scenes, dialog, choices, inventory, two-screen sync)
- `tools/build-simulator.py` → `sim/thor-ide-simulator.html` – browser simulator of the whole thing
- `app/src/main/assets/templates/` – new-project templates
