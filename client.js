/**
 * Browser half of the html-preview bundle: the `render_html` tool view.
 *
 * The bundle is a classic script in the client module system's factory form, so
 * it may require only the seeded platform words (`react`). Nothing here imports
 * a Harness Client package: the card is built from plain elements plus the
 * `--dsw-*` design tokens, which are the only shared styling dependency.
 *
 * Rendering model (a sandboxed, auto-sized frame):
 * - One constant "receiver" document is the iframe's `srcdoc`. Model HTML never
 *   becomes the document, so the frame never reloads while the call streams.
 * - While the call is still being written, the raw argument prefix is decoded
 *   from the partial JSON and pushed in as sanitized markup (no scripts, no
 *   event-handler attributes).
 * - Once the call settles, the complete markup is pushed in and its `<script>`
 *   elements run exactly once, in document order.
 * - The receiver measures its own content and reports the height back, so the
 *   card grows with the preview instead of scrolling a fixed box.
 */
window.__ModuleLoader__.load({
  id: 'dsh-html-live-preview',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var h = React.createElement;

    /** Wire tool name this view renders (the keyed dispatch value). */
    var TOOL_NAME = 'render_html';
    /** Marker every receiver message carries, so foreign frames are ignored. */
    var MESSAGE_SOURCE = 'dsh-html-preview';
    /** Locale namespace owned by this plugin. */
    var NS = 'html-preview';
    /** Class prefix for every element this plugin renders. */
    var CARD = 'dshx';
    /** Injected <style> identity, matching the module system's ownership tags. */
    var CSS_TAG_ID = 'dsh-html-live-preview/client.css';

    /** Debounce between streamed argument prefixes and the frame update. */
    var STREAM_DEBOUNCE = 120;
    /** Shortest partial snippet worth injecting (shorter reads as a flash). */
    var MIN_HTML = 12;
    /** Visible height bounds, in CSS pixels. */
    var MIN_HEIGHT = 24;
    var DEFAULT_CAP = 620;
    var EXPANDED_CAP = 2400;
    /** Height cache keyed by call id, so a remount never collapses the frame. */
    var heightCache = new Map();

    /* ------------------------------------------------------------------ *
     * Styles (injected once, at materialization time)
     * ------------------------------------------------------------------ */

    var CSS = [
      '.' + CARD + '-card{display:flex;flex-direction:column;margin:4px 0 6px 4px;min-width:0}',
      '.' + CARD + '-head{display:flex;align-items:center;gap:6px;height:calc(24px + var(--dsh-content-font-delta,0px));min-width:0}',
      '.' + CARD + '-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}',
      '.' + CARD + '-title{flex:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95));max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.' + CARD + '-dot{flex:none;width:2px;height:2px;border-radius:1px;background:var(--dsw-alias-label-caption,rgba(127,127,127,.6));margin:0 2px}',
      '.' + CARD + '-summary{flex:1 1 auto;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.' + CARD + '-summary[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.' + CARD + '-live{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4d6bfe);margin-right:6px;vertical-align:middle;animation:' + CARD + '-pulse 1.4s ease-in-out infinite}',
      '@keyframes ' + CARD + '-pulse{0%,100%{opacity:.35}50%{opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.' + CARD + '-live{animation:none;opacity:.8}}',
      '.' + CARD + '-actions{flex:none;display:flex;align-items:center;gap:2px;margin-left:auto}',
      '.' + CARD + '-action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));cursor:pointer;opacity:0;transition:opacity .1s ease,background-color .1s ease,color .1s ease}',
      '.' + CARD + '-card:hover .' + CARD + '-action,.' + CARD + '-action:focus-visible,.' + CARD + '-action[aria-pressed="true"]{opacity:1}',
      '.' + CARD + '-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}',
      '.' + CARD + '-action:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:1px}',
      '.' + CARD + '-stage{position:relative;margin-top:4px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));overflow:hidden}',
      '.' + CARD + '-frame{display:block;width:100%;border:0;background:transparent;transition:height .22s ease-out}',
      '.' + CARD + '-waiting{display:flex;align-items:center;gap:8px;padding:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));font-size:var(--dsh-content-font-size-secondary,13px)}',
      '.' + CARD + '-shimmer{flex:none;width:44px;height:8px;border-radius:4px;background:linear-gradient(90deg,transparent,var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.2)),transparent);background-size:200% 100%;animation:' + CARD + '-sweep 1.4s linear infinite}',
      '@keyframes ' + CARD + '-sweep{from{background-position:150% 0}to{background-position:-50% 0}}',
      '@media (prefers-reduced-motion:reduce){.' + CARD + '-shimmer{animation:none}}',
      '.' + CARD + '-clip{position:absolute;inset:auto 0 0 0;display:flex;justify-content:center;padding:18px 0 6px;background:linear-gradient(to bottom,transparent,var(--dsw-alias-bg-base,rgba(127,127,127,.06)));pointer-events:none}',
      '.' + CARD + '-clipButton{pointer-events:auto;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,inherit);font-size:11px;line-height:16px;padding:2px 10px;cursor:pointer}',
      '.' + CARD + '-clipButton:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.' + CARD + '-source{margin:4px 0 0;padding:10px 12px;max-height:320px;overflow:auto;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-markdown-code-block,rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary,inherit);font:var(--dsw-font-markdown-code-block,12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.' + CARD + '-note{margin:4px 0 0;padding:6px 10px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-state-error-primary,#e5484d);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 12%,transparent);color:var(--dsw-alias-state-error-primary,#e5484d);font-size:11px;line-height:16px;display:flex;align-items:flex-start;gap:6px}',
      '.' + CARD + '-noteText{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
      '.' + CARD + '-noteClose{border:0;background:transparent;color:inherit;cursor:pointer;padding:0 2px;line-height:16px}',
      '.' + CARD + '-copied{font-size:11px;color:var(--dsw-alias-state-success-primary,#30a46c);line-height:calc(24px + var(--dsh-content-font-delta,0px))}',
      '.' + CARD + '-tail{display:flex;flex-direction:column;gap:2px}',
    ].join('\n');

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') === null) {
      var cssTag = document.createElement('style');
      cssTag.dataset.plugin = 'dsh-html-live-preview';
      cssTag.dataset.pluginCss = CSS_TAG_ID;
      cssTag.textContent = CSS;
      document.head.appendChild(cssTag);
    }

    /* ------------------------------------------------------------------ *
     * Icons (inline, currentColor)
     * ------------------------------------------------------------------ */

    function icon(children) {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, children);
    }

    var ICON_PREVIEW = icon([
      h('rect', { key: 'w', x: 1.8, y: 3, width: 12.4, height: 10, rx: 2 }),
      h('path', { key: 'b', d: 'M1.8 6.2h12.4' }),
      h('path', { key: 'c', d: 'M4.4 4.6h.01M6.4 4.6h.01' }),
    ]);
    var ICON_CODE = icon([h('path', { key: 'l', d: 'M6 4.5 2.5 8 6 11.5' }), h('path', { key: 'r', d: 'M10 4.5 13.5 8 10 11.5' })]);
    var ICON_COPY = icon([h('rect', { key: 'r', x: 5.5, y: 5.5, width: 7, height: 7, rx: 1.5 }), h('path', { key: 'p', d: 'M10.5 3.5h-6a1 1 0 0 0-1 1v6' })]);
    var ICON_REFRESH = icon([h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.7-3.8' }), h('path', { key: 'b', d: 'M13 2.6V5.4h-2.8' })]);
    var ICON_EXPAND = icon([h('path', { key: 'a', d: 'M6.5 2.5h-4v4' }), h('path', { key: 'b', d: 'M9.5 13.5h4v-4' })]);
    var ICON_COLLAPSE = icon([h('path', { key: 'a', d: 'M2.5 6.5h4v-4' }), h('path', { key: 'b', d: 'M13.5 9.5h-4v4' })]);

    /* ------------------------------------------------------------------ *
     * Theme bridge: host tokens into the frame
     * ------------------------------------------------------------------ */

    /** Declared custom-property names, scanned once per page load. */
    var knownNames = null;

    /** Collect every declared custom property name from one rule list. */
    function collectNames(rules, names) {
      if (!rules) return;
      for (var index = 0; index < rules.length; index += 1) {
        var rule = rules[index];
        if (rule.style) {
          for (var slot = 0; slot < rule.style.length; slot += 1) {
            var property = rule.style[slot];
            if (property && property.slice(0, 2) === '--') names[property] = true;
          }
        }
        if (rule.cssRules) collectNames(rule.cssRules, names);
      }
    }

    /** Names worth bridging: the theme's own token families. */
    function bridgedNames(computed) {
      if (knownNames === null) {
        var names = {};
        var sheets = document.styleSheets;
        for (var index = 0; index < sheets.length; index += 1) {
          try {
            collectNames(sheets[index].cssRules, names);
          } catch (error) {
            /* a cross-origin sheet cannot be read; the computed pass still covers it */
          }
        }
        for (var entry = 0; entry < computed.length; entry += 1) {
          var name = computed[entry];
          if (name && name.slice(0, 2) === '--') names[name] = true;
        }
        knownNames = Object.keys(names);
      }
      return knownNames;
    }

    /** Read the live host theme as the frame should see it. */
    function readTheme() {
      var computed = window.getComputedStyle(document.documentElement);
      var vars = {};
      bridgedNames(computed).forEach(function (property) {
        if (property.indexOf('--dsw-') !== 0 && property.indexOf('--dsh-') !== 0) return;
        var value = computed.getPropertyValue(property).trim();
        if (value !== '') vars[property] = value;
      });
      var dark = document.documentElement.classList.contains('dark');
      return { vars: vars, dark: dark, css: themeCss(vars, dark) };
    }

    /** Compose the frame's `:root` block: host variables, then readable aliases. */
    function themeCss(vars, dark) {
      var text = dark ? '#e6e6e6' : '#1f1f1f';
      var textSecondary = dark ? 'rgba(230,230,230,.72)' : 'rgba(31,31,31,.7)';
      var border = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)';
      var lines = [':root{'];
      Object.keys(vars).forEach(function (name) {
        lines.push(name + ':' + vars[name] + ';');
      });
      lines.push('}');
      lines.push([
        ':root{',
        '--color-background-primary:var(--dsw-alias-bg-base,transparent);',
        '--color-background-secondary:var(--dsw-alias-bg-layer-1,' + (dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)') + ');',
        '--color-background-tertiary:var(--dsw-alias-bg-layer-2,' + (dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.07)') + ');',
        '--color-text-primary:var(--dsw-alias-label-primary,' + text + ');',
        '--color-text-secondary:var(--dsw-alias-label-secondary,' + textSecondary + ');',
        '--color-text-tertiary:var(--dsw-alias-label-tertiary,' + textSecondary + ');',
        '--color-border-primary:var(--dsw-alias-border-l3,' + border + ');',
        '--color-border-secondary:var(--dsw-alias-border-l2,' + border + ');',
        '--color-border-tertiary:var(--dsw-alias-border-l1,' + border + ');',
        '--color-accent:var(--dsw-alias-brand-primary,#4d6bfe);',
        '--color-link:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#4d6bfe));',
        '--color-danger:var(--dsw-alias-state-error-primary,#e5484d);',
        '--color-warning:var(--dsw-alias-state-warn-primary,#f5a524);',
        '--color-success:var(--dsw-alias-state-success-primary,#30a46c);',
        '--color-code-background:var(--dsw-alias-markdown-code-block,' + (dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)') + ');',
        '--font-sans:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);',
        '--font-mono:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,monospace);',
        '--radius-sm:var(--dsw-radius-sm,6px);',
        '--radius-md:var(--dsw-radius-md,8px);',
        '--radius-lg:var(--dsw-radius-lg,12px);',
        'color-scheme:' + (dark ? 'dark' : 'light') + ';',
        '}',
        'html,body{margin:0;padding:0;background:transparent;}',
        'body{color:var(--color-text-primary);font:14px/1.55 var(--font-sans);-webkit-font-smoothing:antialiased;overflow-x:hidden;}',
        '#dsh-html-preview-root{min-height:1px;}',
        '#dsh-html-preview-root>:first-child{margin-top:0;}',
        '#dsh-html-preview-root>:last-child{margin-bottom:0;}',
        'a{color:var(--color-link);}',
        'img,svg,video,canvas{max-width:100%;}',
        '::-webkit-scrollbar{width:8px;height:8px;}',
        '::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,' + (dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.22)') + ');border-radius:4px;}',
        '::-webkit-scrollbar-track{background:transparent;}',
      ].join('\n'));
      return lines.join('\n');
    }

    /* ------------------------------------------------------------------ *
     * Receiver document (constant srcdoc)
     * ------------------------------------------------------------------ */

    /** CSP of the preview frame: no network, inline markup/scripts only. */
    var FRAME_CSP = [
      "default-src 'none'",
      "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh",
      "style-src 'unsafe-inline'",
      "img-src data: blob: https:",
      "font-src data: https:",
      "media-src data: blob: https:",
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "worker-src 'none'",
    ].join('; ');

    /**
     * Build the frame document. It never changes for the life of one card: the
     * model's markup arrives over postMessage instead, so a streaming call
     * updates the same document instead of reloading the frame.
     */
    function receiverDocument(themeCssText) {
      return [
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        '<meta charset="utf-8">',
        '<meta http-equiv="Content-Security-Policy" content="' + FRAME_CSP + '">',
        '<style id="dsh-theme">' + themeCssText + '</style>',
        '</head>',
        '<body>',
        '<div id="dsh-html-preview-root"></div>',
        '<script>' + RECEIVER_JS + '<\/script>',
        '</body>',
        '</html>',
      ].join('');
    }

    /**
     * The frame's only script: sanitize, inject, measure, and report. Written
     * without template literals so it survives this host string verbatim.
     */
    var RECEIVER_JS = [
      '(function () {',
      '  var SOURCE = ' + JSON.stringify(MESSAGE_SOURCE) + ';',
      '  /* Forms stay: the sandbox has no allow-forms and the CSP no form-action, so a',
      '     submitted form cannot leave the frame. */',
      '  var DANGEROUS = "iframe,object,embed,meta,link,base";',
      '  var root = document.getElementById("dsh-html-preview-root");',
      '  var lastHeight = 0;',
      '  var finalKey = null;',
      '  var runs = 0;',
      '  var reported = 0;',
      '',
      '  function post(type, payload) {',
      '    var message = { source: SOURCE, type: type };',
      '    if (payload) { for (var key in payload) { if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key]; } }',
      '    try { parent.postMessage(message, "*"); } catch (error) { /* detached */ }',
      '  }',
      '',
      '  function report(text) {',
      '    if (reported >= 4) return;',
      '    reported += 1;',
      '    post("error", { message: String(text).slice(0, 300) });',
      '  }',
      '',
      '  /* ---- height ---- */',
      '  var heightTimer = null;',
      '  function measure(force) {',
      '    if (heightTimer !== null) clearTimeout(heightTimer);',
      '    heightTimer = setTimeout(function () {',
      '      heightTimer = null;',
      '      var rect = root.getBoundingClientRect();',
      '      var height = Math.ceil(Math.max(rect.height, root.scrollHeight || 0));',
      '      if (height > 0 && (force === true || height !== lastHeight)) { lastHeight = height; post("resize", { height: height }); }',
      '    }, 60);',
      '  }',
      '  if (typeof ResizeObserver === "function") { new ResizeObserver(function () { measure(false); }).observe(root); }',
      '  window.addEventListener("resize", function () { measure(false); });',
      '  window.addEventListener("load", function () { measure(true); });',
      '',
      '  /* ---- diagnostics ---- */',
      '  window.addEventListener("error", function (event) {',
      '    var target = event && event.target;',
      '    /* An <img> that cannot load is ordinary web content, not a preview defect;',
      '       a subresource the model asked for by URL is worth reporting. */',
      '    if (target && target !== window && target.tagName === "IMG") return;',
      '    if (target && target !== window && target.tagName) report("Failed to load " + target.tagName.toLowerCase() + (target.src ? ": " + target.src : ""));',
      '    else report((event && event.message) || "Script error");',
      '  }, true);',
      '  window.addEventListener("unhandledrejection", function (event) {',
      '    var reason = event && event.reason;',
      '    report("Unhandled rejection: " + ((reason && reason.message) || reason));',
      '  });',
      '  var consoleError = console.error;',
      '  console.error = function () {',
      '    var parts = [];',
      '    for (var index = 0; index < arguments.length; index += 1) {',
      '      var value = arguments[index];',
      '      parts.push(value instanceof Error ? value.message : typeof value === "string" ? value : String(value));',
      '    }',
      '    report(parts.join(" "));',
      '    consoleError.apply(console, arguments);',
      '  };',
      '',
      '  /* ---- sanitizing ---- */',
      '  function parse(html) { return new DOMParser().parseFromString(String(html == null ? "" : html), "text/html"); }',
      '  /* While the call is still streaming, everything executable is removed: markup',
      '     inserted through innerHTML does not run <script>, but an <img onerror> does.',
      '     The finalized pass keeps scripts and inline handlers, which is what makes a',
      '     preview interactive, and leaves containment to the sandbox and the CSP. */',
      '  function scrub(doc, keepScripts) {',
      '    var junk = doc.querySelectorAll(DANGEROUS);',
      '    for (var index = 0; index < junk.length; index += 1) { junk[index].parentNode.removeChild(junk[index]); }',
      '    if (!keepScripts) {',
      '      var scripts = doc.querySelectorAll("script");',
      '      for (var s = 0; s < scripts.length; s += 1) { scripts[s].parentNode.removeChild(scripts[s]); }',
      '    }',
      '    var all = doc.querySelectorAll("*");',
      '    for (var e = 0; e < all.length; e += 1) {',
      '      var attrs = all[e].attributes;',
      '      for (var a = attrs.length - 1; a >= 0; a -= 1) {',
      '        var attribute = attrs[a];',
      '        var name = attribute.name.toLowerCase();',
      '        if (!keepScripts && name.indexOf("on") === 0 && name.length > 2) { all[e].removeAttribute(attribute.name); continue; }',
      '        if ((name === "href" || name === "src" || name === "xlink:href") && /^\\s*(javascript|vbscript):/i.test(attribute.value)) all[e].removeAttribute(attribute.name);',
      '      }',
      '    }',
      '    return doc;',
      '  }',
      '  function markup(doc) { return (doc.head ? doc.head.innerHTML : "") + (doc.body ? doc.body.innerHTML : ""); }',
      '',
      '  /* ---- script execution (once per finalized markup) ---- */',
      '  function runScripts(scripts) {',
      '    var index = 0;',
      '    function step() {',
      '      if (index >= scripts.length) { measure(true); post("settled", { runs: runs }); return; }',
      '      var source = scripts[index];',
      '      index += 1;',
      '      var element = document.createElement("script");',
      '      var attrs = source.attributes;',
      '      for (var a = 0; a < attrs.length; a += 1) element.setAttribute(attrs[a].name, attrs[a].value);',
      '      var src = source.getAttribute("src");',
      '      var isModule = /module/i.test(source.getAttribute("type") || "");',
      '      if (src) {',
      '        element.addEventListener("load", function () { step(); });',
      '        element.addEventListener("error", function () { report("Failed to load script: " + src); step(); });',
      '        document.body.appendChild(element);',
      '        return;',
      '      }',
      '      element.textContent = source.textContent || "";',
      '      document.body.appendChild(element);',
      '      if (isModule) { setTimeout(step, 0); return; }',
      '      step();',
      '    }',
      '    if (scripts.length === 0) { measure(true); post("settled", { runs: runs }); return; }',
      '    step();',
      '  }',
      '',
      '  /* ---- message handling ---- */',
      '  function applyStreaming(html) {',
      '    var next = markup(scrub(parse(html), false));',
      '    if (root.innerHTML !== next) root.innerHTML = next;',
      '    runs += 1;',
      '    measure(false);',
      '  }',
      '  function applyFinal(html, force) {',
      '    var key = String(html);',
      '    if (force !== true && key === finalKey) return;',
      '    finalKey = key;',
      '    var doc = scrub(parse(html), true);',
      '    var found = doc.querySelectorAll("script");',
      '    var scripts = [];',
      '    for (var index = 0; index < found.length; index += 1) scripts.push(found[index]);',
      '    for (var s = 0; s < scripts.length; s += 1) scripts[s].parentNode.removeChild(scripts[s]);',
      '    root.innerHTML = markup(doc);',
      '    runs += 1;',
      '    runScripts(scripts);',
      '  }',
      '  function applyTheme(css) {',
      '    var tag = document.getElementById("dsh-theme");',
      '    if (tag && typeof css === "string") tag.textContent = css;',
      '    measure(true);',
      '  }',
      '',
      '  window.addEventListener("message", function (event) {',
      '    var data = event.data;',
      '    if (!data || data.source !== SOURCE) return;',
      '    if (data.type === "render") applyStreaming(data.html);',
      '    else if (data.type === "finalize") applyFinal(data.html, data.force === true);',
      '    else if (data.type === "theme") applyTheme(data.css);',
      '  });',
      '',
      '  document.addEventListener("click", function (event) {',
      '    var node = event.target;',
      '    while (node && node.nodeType === 1 && node.tagName !== "A") node = node.parentNode;',
      '    if (!node || node.nodeType !== 1 || typeof node.getAttribute !== "function") return;',
      '    var href = node.getAttribute("href");',
      '    if (!href) return;',
      '    event.preventDefault();',
      '    post("link", { href: href });',
      '  }, true);',
      '',
      '  post("ready", {});',
      '}());',
    ].join('\n');

    /* ------------------------------------------------------------------ *
     * Arrow helpers
     * ------------------------------------------------------------------ */

    /** Copy own enumerable members onto a fresh message object. */
    function withSource(message) {
      var payload = { source: MESSAGE_SOURCE };
      Object.keys(message).forEach(function (key) {
        payload[key] = message[key];
      });
      return payload;
    }

    /** Post one message into the preview frame. */
    function postToFrame(frame, message) {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(withSource(message), '*');
      } catch (error) {
        /* the frame is mid-teardown */
      }
    }

    /** Open an http(s)/mailto destination the preview asked for. */
    function openExternalLink(href) {
      var value = String(href == null ? '' : href).trim();
      if (!/^(https?:|mailto:)/i.test(value)) return;
      window.open(value, '_blank', 'noopener,noreferrer');
    }

    /** Format a character count for the row summary. */
    function sizeText(characters) {
      if (!characters) return '';
      if (characters < 1024) return characters + ' B';
      if (characters < 1024 * 1024) return (characters / 1024).toFixed(1) + ' KB';
      return (characters / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /** First line of a failed result's model-facing content. */
    function errorText(block) {
      var content = block && block.content;
      if (!content || content.length === 0) return '';
      for (var index = 0; index < content.length; index += 1) {
        var item = content[index];
        if (item && item.type === 'text' && typeof item.text === 'string') {
          var line = item.text.split('\n')[0].trim();
          if (line !== '') return line;
        }
      }
      return '';
    }

    /* ------------------------------------------------------------------ *
     * Partial-argument decoding
     * ------------------------------------------------------------------ */

    /** Escape raw control characters that an in-flight JSON string may hold. */
    function escapeControls(text) {
      var out = '';
      for (var index = 0; index < text.length; index += 1) {
        var code = text.charCodeAt(index);
        if (code < 0x20) out += '\\u' + ('000' + code.toString(16)).slice(-4);
        else out += text[index];
      }
      return out;
    }

    /** Decode a (possibly truncated) JSON string body. */
    function decodeString(fragment) {
      var body = escapeControls(fragment);
      for (var attempt = 0; attempt < 3; attempt += 1) {
        try {
          return JSON.parse('"' + body + '"');
        } catch (error) {
          if (/\\$/.test(body)) {
            body = body.slice(0, -1);
            continue;
          }
          if (/\\u[0-9a-fA-F]{0,3}$/.test(body)) {
            body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
            continue;
          }
          break;
        }
      }
      return body.replace(/\\(["\\/bfnrt])/g, '$1');
    }

    /** Index of a JSON string body's closing quote, ignoring escaped quotes. */
    function stringEnd(text) {
      for (var index = 0; index < text.length; index += 1) {
        if (text[index] === '\\') {
          index += 1;
          continue;
        }
        if (text[index] === '"') return index;
      }
      return -1;
    }

    /** Read one string field from complete JSON, or from a partial prefix. */
    function readStringField(raw, field) {
      var marker = '"' + field + '"';
      var found = raw.indexOf(marker);
      if (found < 0) return undefined;
      var colon = raw.indexOf(':', found + marker.length);
      if (colon < 0) return undefined;
      var open = raw.indexOf('"', colon + 1);
      if (open < 0) return undefined;
      var rest = raw.slice(open + 1);
      var end = stringEnd(rest);
      return decodeString(end < 0 ? rest : rest.slice(0, end));
    }

    /** Read one numeric field from complete JSON, or from a partial prefix. */
    function readNumberField(raw, field) {
      var marker = '"' + field + '"';
      var found = raw.indexOf(marker);
      if (found < 0) return undefined;
      var colon = raw.indexOf(':', found + marker.length);
      if (colon < 0) return undefined;
      var match = /^\s*(-?\d+(?:\.\d+)?)/.exec(raw.slice(colon + 1));
      if (!match) return undefined;
      var value = Number(match[1]);
      return isFinite(value) ? value : undefined;
    }

    /**
     * Decode the call arguments, complete or still streaming. A complete object
     * parses directly; otherwise each field is read from the raw prefix, so a
     * preview can render before the model has written the closing brace.
     */
    function parseArguments(raw) {
      if (typeof raw !== 'string' || raw === '') return { html: '', title: '', height: 0, complete: false };
      try {
        var full = JSON.parse(raw);
        if (full && typeof full === 'object') {
          return {
            html: typeof full.html === 'string' ? full.html : '',
            title: typeof full.title === 'string' ? full.title : '',
            height: typeof full.height === 'number' ? full.height : 0,
            complete: true,
          };
        }
      } catch (error) {
        /* still streaming */
      }
      return {
        html: readStringField(raw, 'html') || '',
        title: readStringField(raw, 'title') || '',
        height: readNumberField(raw, 'height') || 0,
        complete: false,
      };
    }

    /** Build a title from the decoded arguments, the result metadata, or locale. */
    function titleOf(parsed, meta, t) {
      if (parsed.title) return parsed.title;
      if (meta && typeof meta.title === 'string' && meta.title !== '') return meta.title;
      return t('row.title');
    }

    /* ------------------------------------------------------------------ *
     * The tool view
     * ------------------------------------------------------------------ */

    /**
     * Render one `render_html` call: a live, sandboxed, auto-sized preview with
     * row chrome that matches the other Tool cards.
     * @param props - keyed toolview payload plus the locale seat.
     * @returns the HTML preview card.
     */
    function HtmlPreviewRow(props) {
      var phase = props.phase;
      var block = props.block;
      /* Both seats are registration-stable; the guards only keep a partially
       * composed slot from blanking the row. */
      var t = typeof props.t === 'function' ? props.t : function (key) { return en[key] || key; };
      var callId = props.callId;
      /* Subscribes to this call's raw argument prefix while it is still being
       * written; other phases return an empty string. */
      var partial = typeof props.useToolCallArgumentsPartial === 'function' ? props.useToolCallArgumentsPartial() : '';

      var settled = phase === 'result';
      var failure = settled && block.isError === true;
      var meta = settled && block.meta && typeof block.meta === 'object' ? block.meta : null;
      var rawArgs = phase === 'preparing'
        ? partial
        : phase === 'start'
          ? (block.argsRaw || '')
          : (block.call ? block.call.argsRaw : '');

      var parsed = React.useMemo(function () { return parseArguments(rawArgs); }, [rawArgs]);
      var html = parsed.html || '';
      var hasHtml = html.trim().length >= MIN_HTML;
      var characters = hasHtml ? html.length : (meta && typeof meta.characters === 'number' ? meta.characters : 0);

      var frameRef = React.useRef(null);
      var lastSentRef = React.useRef(null);
      var lastFinalRef = React.useRef(null);
      var firstHeightRef = React.useRef(true);

      var readyState = React.useState(false);
      var ready = readyState[0];
      var setReady = readyState[1];
      var heightState = React.useState(function () { return heightCache.get(callId) || 0; });
      var contentHeight = heightState[0];
      var setContentHeight = heightState[1];
      var expandedState = React.useState(false);
      var expanded = expandedState[0];
      var setExpanded = expandedState[1];
      var sourceState = React.useState(false);
      var showSource = sourceState[0];
      var setShowSource = sourceState[1];
      var diagnosticsState = React.useState([]);
      var diagnostics = diagnosticsState[0];
      var setDiagnostics = diagnosticsState[1];
      var revisionState = React.useState(0);
      var revision = revisionState[0];
      var setRevision = revisionState[1];
      var copiedState = React.useState(false);
      var copied = copiedState[0];
      var setCopied = copiedState[1];
      var scriptsState = React.useState(true);
      var scriptsRun = scriptsState[0];
      var setScriptsRun = scriptsState[1];

      /* One constant frame document per card: never rebuilt, so streaming
       * updates reuse the same document and never reload it. */
      var initialTheme = React.useMemo(function () { return readTheme(); }, []);
      var srcdoc = React.useMemo(function () { return receiverDocument(initialTheme.css); }, [initialTheme]);

      /* Frame -> card messages. */
      React.useEffect(function () {
        function onMessage(event) {
          var frame = frameRef.current;
          if (!frame || event.source !== frame.contentWindow) return;
          var data = event.data;
          if (!data || data.source !== MESSAGE_SOURCE) return;
          if (data.type === 'ready') {
            setReady(true);
            return;
          }
          if (data.type === 'resize') {
            if (typeof data.height === 'number' && data.height > 0) {
              heightCache.set(callId, data.height);
              setContentHeight(data.height);
            }
            return;
          }
          if (data.type === 'error') {
            setDiagnostics(function (list) {
              var message = String(data.message || 'error');
              if (list.length >= 4 || list.indexOf(message) >= 0) return list;
              return list.concat([message]);
            });
            return;
          }
          if (data.type === 'settled') {
            setScriptsRun(true);
            return;
          }
          if (data.type === 'link') openExternalLink(data.href);
        }
        window.addEventListener('message', onMessage);
        return function () { window.removeEventListener('message', onMessage); };
      }, [callId]);

      /* Card -> frame: streamed markup while the call is written, the complete
       * markup (scripts included) once it settles. */
      React.useEffect(function () {
        var frame = frameRef.current;
        if (!frame || !ready) return undefined;
        if (!settled) {
          if (!hasHtml) return undefined;
          if (lastSentRef.current === html) return undefined;
          var timer = setTimeout(function () {
            lastSentRef.current = html;
            postToFrame(frame, { type: 'render', html: html });
          }, STREAM_DEBOUNCE);
          return function () { clearTimeout(timer); };
        }
        var key = revision + '|' + html;
        if (lastFinalRef.current === key) return undefined;
        if (html.trim() === '') return undefined;
        lastFinalRef.current = key;
        setScriptsRun(false);
        postToFrame(frame, { type: 'finalize', html: html, force: revision > 0 });
        return undefined;
      }, [html, hasHtml, settled, ready, revision]);

      /* Host theme changes reach the frame without rebuilding it. */
      React.useEffect(function () {
        function push() {
          var frame = frameRef.current;
          if (!frame) return;
          var theme = readTheme();
          postToFrame(frame, { type: 'theme', css: theme.css });
        }
        var observer = new MutationObserver(push);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        if (media && media.addEventListener) media.addEventListener('change', push);
        return function () {
          observer.disconnect();
          if (media && media.removeEventListener) media.removeEventListener('change', push);
        };
      }, []);

      var requested = parsed.height;
      var baseCap = requested > 0 ? Math.min(Math.max(requested, 120), EXPANDED_CAP) : DEFAULT_CAP;
      var cap = expanded ? Math.max(baseCap, EXPANDED_CAP) : baseCap;
      var frameHeight = contentHeight > 0 ? Math.max(MIN_HEIGHT, Math.min(contentHeight, cap)) : MIN_HEIGHT;
      var clipped = contentHeight > cap + 1;
      /* A settled call whose head fell outside the loaded window carries no
       * arguments: say so instead of showing an empty frame. */
      var headless = settled && !hasHtml && meta === null;

      function handleLoad() {
        setReady(true);
      }

      function toggleSource() {
        setShowSource(function (value) { return !value; });
      }

      function refresh() {
        setDiagnostics([]);
        lastSentRef.current = null;
        setRevision(function (value) { return value + 1; });
      }

      function copySource() {
        var write = navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(html)
          : Promise.reject(new Error('unavailable'));
        write.then(function () {
          setCopied(true);
          setTimeout(function () { setCopied(false); }, 1600);
        }, function () {
          /* clipboard refused; the source view remains the fallback */
        });
      }

      var summaryTone = failure ? 'error' : undefined;
      var summary;
      if (failure) summary = errorText(block) || t('row.failed');
      else if (phase === 'preparing') summary = t('row.streaming');
      else if (phase === 'start') summary = t('row.rendering');
      else summary = scriptsRun === false ? t('row.scripts') : t('row.rendered');

      var actions = [
        h('button', {
          key: 'source',
          type: 'button',
          className: CARD + '-action',
          title: t('action.source'),
          'aria-label': t('action.source'),
          'aria-pressed': showSource,
          onClick: toggleSource,
        }, ICON_CODE),
        h('button', {
          key: 'copy',
          type: 'button',
          className: CARD + '-action',
          title: t('action.copy'),
          'aria-label': t('action.copy'),
          onClick: copySource,
        }, ICON_COPY),
      ];
      if (settled) {
        actions.push(h('button', {
          key: 'refresh',
          type: 'button',
          className: CARD + '-action',
          title: t('action.refresh'),
          'aria-label': t('action.refresh'),
          onClick: refresh,
        }, ICON_REFRESH));
      }
      if (contentHeight > baseCap + 1 || expanded) {
        actions.push(h('button', {
          key: 'expand',
          type: 'button',
          className: CARD + '-action',
          title: expanded ? t('action.collapse') : t('action.expand'),
          'aria-label': expanded ? t('action.collapse') : t('action.expand'),
          'aria-pressed': expanded,
          onClick: function () { setExpanded(function (value) { return !value; }); },
        }, expanded ? ICON_COLLAPSE : ICON_EXPAND));
      }

      return h('div', {
        className: CARD + '-card',
        'data-tool': TOOL_NAME,
        'data-state': failure ? 'error' : phase,
      }, [
        h('div', { key: 'head', className: CARD + '-head' }, [
          h('span', { key: 'glyph', className: CARD + '-glyph' }, ICON_PREVIEW),
          h('span', { key: 'title', className: CARD + '-title', title: parsed.title || undefined }, titleOf(parsed, meta, t)),
          h('span', { key: 'dot', className: CARD + '-dot', 'aria-hidden': true }),
          h('span', { key: 'summary', className: CARD + '-summary', 'data-tone': summaryTone }, [
            !settled ? h('span', { key: 'live', className: CARD + '-live', 'aria-hidden': true }) : null,
            summary,
            settled && failure === false && characters > 0 ? ' · ' + sizeText(characters) : null,
          ]),
          copied ? h('span', { key: 'copied', className: CARD + '-copied' }, t('action.copied')) : null,
          h('span', { key: 'actions', className: CARD + '-actions' }, actions),
        ]),
        showSource
          ? h('pre', { key: 'source', className: CARD + '-source' }, rawArgs || t('source.empty'))
          : null,
        h('div', {
          key: 'stage',
          className: CARD + '-stage',
          style: showSource ? { display: 'none' } : undefined,
        }, [
          h('iframe', {
            key: 'frame',
            ref: frameRef,
            className: CARD + '-frame',
            sandbox: 'allow-scripts',
            srcDoc: srcdoc,
            title: titleOf(parsed, meta, t),
            onLoad: handleLoad,
            style: { height: frameHeight + 'px' },
          }),
          !hasHtml && !settled
            ? h('div', { key: 'waiting', className: CARD + '-waiting' }, [
              h('span', { key: 'shimmer', className: CARD + '-shimmer', 'aria-hidden': true }),
              h('span', { key: 'text' }, t('row.waiting')),
            ])
            : null,
          headless
            ? h('div', { key: 'headless', className: CARD + '-waiting' }, t('row.unavailable'))
            : null,
          clipped && !expanded
            ? h('div', { key: 'clip', className: CARD + '-clip' }, h('button', {
              type: 'button',
              className: CARD + '-clipButton',
              onClick: function () { setExpanded(true); },
            }, t('action.expand')))
            : null,
        ]),
        diagnostics.length > 0
          ? h('div', { key: 'note', className: CARD + '-note' }, [
            h('span', { key: 'text', className: CARD + '-noteText' }, t('note.runtime') + ' ' + diagnostics.join(' · ')),
            h('button', {
              key: 'close',
              type: 'button',
              className: CARD + '-noteClose',
              'aria-label': t('note.dismiss'),
              onClick: function () { setDiagnostics([]); },
            }, '×'),
          ])
          : null,
      ]);
    }

    /* ------------------------------------------------------------------ *
     * The completed-turn surface
     * ------------------------------------------------------------------ */

    /** Chat node kind carrying one root Tool call (`ToolChatData.root`). */
    var TOOL_CALL_KIND = 'tool-call';
    /** Stable empty snapshot for a turn with no readable node source. */
    var NO_NODES = [];
    /** Stable no-op subscription for the same case. */
    function subscribeNothing() { return function () {}; }
    /** Stable empty reader for the same case. */
    function readNothing() { return NO_NODES; }

    /** Collect this turn's `render_html` calls, including nested dispatches. */
    function collectPreviews(blocks, found) {
      for (var index = 0; index < blocks.length; index += 1) {
        var block = blocks[index];
        if (!block) continue;
        var name = block.call ? block.call.name : block.name;
        if (name === TOOL_NAME) found.push(block);
        if (block.subCalls && block.subCalls.length > 0) collectPreviews(block.subCalls, found);
      }
      return found;
    }

    /** Synthesize the toolview props a stored block would have received live. */
    function storedProps(block, callId, t) {
      var settled = block.kind === 'tool-result';
      return {
        phase: settled ? 'result' : block.phase === 'start' ? 'start' : 'preparing',
        block: block,
        callId: typeof block.callId === 'string' ? block.callId : callId,
        toolName: TOOL_NAME,
        t: t,
        /* A stored call has no live argument source; its args travel in the block. */
        useToolCallArgumentsPartial: function () { return ''; },
      };
    }

    /**
     * Render this turn's previews after its prose.
     *
     * The tool row folds away with the turn's process disclosure, and a preview
     * that disappears the moment its turn finishes is not much of a preview.
     * The Turn tail is outside that disclosure, so a finished turn keeps its
     * previews where the reader left them; while the turn is still running the
     * tool row owns the live one, which keeps exactly one frame per call.
     * @param props - turn-tail owner props plus the session and locale seats.
     * @returns the turn's previews, or null when it has none.
     */
    function HtmlPreviewTurnTail(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return en[key] || key; };
      var turnNumber = props.turn && typeof props.turn.turn === 'number' ? props.turn.turn : null;
      var running = props.turn !== undefined && props.turn.status === 'open';
      var store = typeof props.useChat === 'function'
        ? props.useChat(function (snapshot) { return snapshot.nodes; })
        : null;
      var source = React.useMemo(function () {
        if (store === null || store === undefined || turnNumber === null) return null;
        if (typeof store.turnDataSource !== 'function') return null;
        try {
          return store.turnDataSource(turnNumber, TOOL_CALL_KIND);
        } catch (error) {
          return null;
        }
      }, [store, turnNumber]);
      var nodes = React.useSyncExternalStore(
        source ? source.subscribe : subscribeNothing,
        source ? source.getSnapshot : readNothing,
      );
      if (running || !nodes || nodes.length === 0) return null;
      var roots = [];
      for (var index = 0; index < nodes.length; index += 1) {
        /* The turn-kind source yields one kind's business data, which is
         * `{ root }` for a Tool call; a node wrapper is accepted too. */
        var entry = nodes[index];
        if (!entry) continue;
        if (entry.root) roots.push(entry.root);
        else if (entry.kind === TOOL_CALL_KIND && entry.data) roots.push(entry.data.root);
      }
      var found = collectPreviews(roots, []);
      if (found.length === 0) return null;
      return h('div', { className: CARD + '-tail' }, found.map(function (block, position) {
        return h(HtmlPreviewRow, Object.assign(storedProps(block, 'tail-' + position, t), {
          key: (block && block.callId) || 'tail-' + position,
        }));
      }));
    }

    /* ------------------------------------------------------------------ *
     * Copy
     * ------------------------------------------------------------------ */

    /** Simplified Chinese dictionary (the key-set source of truth). */
    var zh = {
      'row.title': 'HTML 预览',
      'row.streaming': '正在生成预览',
      'row.rendering': '正在渲染',
      'row.rendered': '已渲染',
      'row.scripts': '正在执行脚本',
      'row.failed': '渲染失败',
      'row.waiting': '等待 HTML 内容…',
      'row.unavailable': '这次调用的 HTML 源码不在当前会话窗口中（会话记录被截断），无法重新渲染。',
      'action.source': '查看 HTML 源码',
      'action.copy': '复制 HTML',
      'action.copied': '已复制',
      'action.refresh': '重新执行脚本',
      'action.expand': '展开高度',
      'action.collapse': '收起高度',
      'note.runtime': '预览中的脚本报错：',
      'note.dismiss': '忽略这些报错',
      'source.empty': '（暂无内容）',
    };
    /** English dictionary, checked complete against the zh key set. */
    var en = {
      'row.title': 'HTML preview',
      'row.streaming': 'Generating preview',
      'row.rendering': 'Rendering',
      'row.rendered': 'Rendered',
      'row.scripts': 'Running scripts',
      'row.failed': 'Preview failed',
      'row.waiting': 'Waiting for HTML…',
      'row.unavailable': 'This call\'s HTML is outside the loaded window, so the preview cannot be rebuilt.',
      'action.source': 'Show HTML source',
      'action.copy': 'Copy HTML',
      'action.copied': 'Copied',
      'action.refresh': 'Re-run scripts',
      'action.expand': 'Expand height',
      'action.collapse': 'Collapse height',
      'note.runtime': 'Script errors in the preview:',
      'note.dismiss': 'Dismiss these errors',
      'source.empty': '(nothing yet)',
    };

    /** Required services: the slot registry and the locale registry. */
    var inject = ['slots', 'locale'];

    /**
     * Mount the `render_html` tool view.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, 'html-preview: dictionaries');
      ctx.slots.inject('tool.call.toolview', function () {
        return ctx.slots.register({
          name: 'tool.call.toolview',
          key: TOOL_NAME,
          locale: NS,
        }, HtmlPreviewRow);
      });
      ctx.slots.inject('conversation.chat.turnTail', function () {
        return ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'dsh-html-live-preview',
          order: 20,
          locale: NS,
        }, HtmlPreviewTurnTail);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
