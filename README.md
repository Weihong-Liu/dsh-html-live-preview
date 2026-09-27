# dsh-html-live-preview

[![npm version](https://img.shields.io/npm/v/dsh-html-live-preview?color=4d6bfe)](https://www.npmjs.com/package/dsh-html-live-preview)
[![license](https://img.shields.io/npm/l/dsh-html-live-preview)](LICENSE)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-4d6bfe)](https://github.com/topics/dsh-plugin)

**Live HTML preview inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) conversations.**
The model calls one tool, and the HTML it writes is rendered in the chat as it streams — not as a code block, and not in a side panel.

[中文说明](README.zh.md) · [npm](https://www.npmjs.com/package/dsh-html-live-preview)

![A preview that stays under the reply once the turn is done](screenshots/turn-tail-persistent.png)

## What you get

- **Live while it is written.** The preview grows in the conversation as the model types the arguments, decoding the partially-written JSON so you see the result before the call is even finished.
- **Interactive when it settles.** `<script>` runs once, in document order, after the markup is final. Buttons, animations, charts and canvas all work.
- **It stays put.** When a turn finishes, DSH folds tool rows into the turn's process disclosure — so the plugin renders the preview a second time in the turn tail, which is outside that fold. One iframe per call at any moment.
- **Theme-aware.** The frame inherits the host's `--dsw-*` / `--dsh-*` design tokens plus a set of readable aliases, and follows light/dark switches live.
- **Honest about failure.** Script errors and failed subresources surface as a dismissible strip under the card, and a preview whose recorded call fell outside the loaded session window says so instead of showing an empty frame.

## Requirements

- DeepSeek Harness with the **web** profile: `dsh web` (verified against `0.1.7-rc.2`).
- The plugin declares `@deepseek-ai/dsh-tools` as a peer, so DSH refuses to load it on a runtime outside that range instead of failing at the first call.

## Install

From the registry, into the profile that runs your Web UI:

```sh
dsh plugin --profile web add dsh-html-live-preview
```

The same operation is available in the Web UI under **Plugins**. Installation selects the bundle, so the row mounts on the next composition (HMR applies it live).

From a checkout of this repository:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-html-live-preview
```

Then **start a new session**: an existing session keeps the tool catalog it was composed with, so the tool appears in the next one.

`render_html` is registered in the tools registry's global layer, so every agent in the profile can call it — no agent-preset edit needed.

## Usage

Ask for something visual, in any wording:

> "Draw a bar chart of this week's latency"
> "Mock up a login page and make the button do something"
> "Animate how quicksort partitions this array"

The model calls `render_html({ html, title?, height? })`. The card offers four controls on hover: **show the HTML source**, **copy it**, **re-run scripts**, and **expand the height** (the frame is capped at 620px by default so a single preview cannot swallow the transcript).

## How it works

**Host half** ([index.js](index.js)) validates the call, caps the snippet at 256 KiB, and returns a receipt of a few tokens. The markup itself stays in the recorded `tool/call` arguments, so reopening a session replays the preview at no extra storage or context cost.

**Browser half** ([client.js](client.js)) is a plain classic script in DSH's client-module factory form — no build step, and nothing imported beyond the seeded `react`:

| Surface | When | Why |
|---|---|---|
| `tool.call.toolview` | while the turn runs | streams the preview from the partially-written arguments |
| `conversation.chat.turnTail` | after the turn closes | the tail is outside the folded process disclosure, so the preview survives |

The frame itself:

1. **A constant receiver document** is the iframe's `srcdoc` — CSP, theme variables and a measurement script. Model HTML never becomes the document; it arrives over `postMessage`, so streaming updates never reload the frame.
2. **Two-phase injection.** While the call streams, scripts and `on*` attributes are stripped before injection (markup inserted through `innerHTML` does not run `<script>`, but an `<img onerror>` does). Once the call settles, the complete markup is injected and its scripts run exactly once, waiting for each external script to load.
3. **Sandbox.** `sandbox="allow-scripts"` with no `allow-same-origin`, so the frame is an opaque origin. The in-frame CSP is `default-src 'none'`, `connect-src 'none'` (no fetch/XHR/WebSocket), `frame-src`/`object-src 'none'`, `base-uri`/`form-action 'none'`; inline scripts, four CDNs (jsdelivr, unpkg, cdnjs, esm.sh) and `data:`/`https:` images and fonts are allowed. Links are forwarded to the host and opened externally after a scheme check.
4. **Auto height.** A `ResizeObserver` inside the frame reports its content height (60 ms debounce); the card clamps it, caches it per call id so a remount never collapses to zero, and grows. Content beyond the cap keeps its own scrollbar and can be expanded to 2400px.

## Verification

Verified against a real DSH Web instance with real model calls (screenshots in [screenshots/](screenshots)): the tool row renders the call, the turn tail keeps previews under their replies after those turns closed, heights came back measured (490px / 260px), and the console stayed clean.

The renderer itself is covered by [test/harness.html](test/harness.html), a standalone page that loads this plugin's `client.js` against real React and exercises streaming, finalizing, sanitizing, height caps, expansion, the source view, theme switching and in-frame error reporting:

```sh
mkdir -p /tmp/hp && cd /tmp/hp
cp /path/to/dsh-html-live-preview/client.js .
cp /path/to/dsh-html-live-preview/test/harness.html .
curl -sO https://unpkg.com/react@18.3.1/umd/react.development.js
curl -sO https://unpkg.com/react@18.3.1/umd/react-dom.development.js
open harness.html
```

## Limitations

- **No fenced-code-block rendering.** DSH has no extension point for custom Markdown fence renderers (`renderCode` inside `ui-primitives` is hard-coded), so ```` ```html ```` stays a code block. A tool call is the supported path.
- **DSH updates.** The declared peer range is `^0.1.7-rc.2`. Outside it DSH disables this plugin and says why, rather than breaking at runtime; widening the range is a one-line change plus a re-check.
- **No network inside the frame**, by design. Visualizations that need data must inline it or load a library from the allowed CDNs.
- **Truncated session windows.** If a recorded call fell outside the loaded window the card cannot rebuild the preview, and says so.
- **Editing the plugin's own code needs a restart.** DSH hot-reloads profile manifests and patches, but client bundles and host modules are cached per process.

## Releasing

Tag-driven: `npm version patch && git push origin main --follow-tags` makes GitHub Actions verify the tag against the manifest, publish to npm through Trusted Publishing (with a provenance attestation), and open a GitHub release. See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
