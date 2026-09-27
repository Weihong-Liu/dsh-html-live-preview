/**
 * Host half of the html-preview bundle: the model-facing `render_html` tool.
 *
 * The tool owns no rendering. It validates one HTML snippet, records its size,
 * and hands the caller a receipt small enough to keep out of the model's way —
 * the markup itself travels in the recorded `tool/call` arguments, which the
 * browser reads directly through the `render_html` tool view.
 * @module dsh-html-live-preview
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

/** Stable Loader identity. */
export const name = 'html-preview';

/** Services used by the tool row. */
export const inject = ['tools'];

/** Largest accepted snippet, in characters (a session-log and context guard). */
const MAX_HTML_CHARS = 256 * 1024;

/**
 * Shorten one line of model text for a card title.
 * @param value - candidate title, however malformed.
 * @returns the trimmed single line, or undefined when nothing usable remains.
 */
function normalizeTitle(value) {
  if (typeof value !== 'string') return undefined;
  const line = value.replace(/\s+/g, ' ').trim();
  if (line.length === 0) return undefined;
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** Human-readable character count for the model-facing receipt. */
function describeSize(characters) {
  return characters >= 1024 ? `${(characters / 1024).toFixed(1)} KiB` : `${characters} chars`;
}

/**
 * Register `render_html` in the tools registry of the mounting scope.
 * @param ctx - mounting context carrying the tools registry.
 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'render_html',
    description: [
      'Render an HTML/CSS/JS snippet as a live, interactive preview inside the conversation.',
      'The user watches it appear while you are still writing the arguments, so prefer this tool over a fenced ```html block in your reply whenever the result is visual: diagrams, charts, dashboards, UI mockups, animations, 3D scenes, geometry or math illustrations, styled tables, and any "show me what this looks like" request.',
      '',
      'How to write the snippet:',
      '- `html` is a FRAGMENT. Do not wrap it in <!DOCTYPE>, <html>, <head>, or <body>; a full document is also accepted but the wrapper is discarded.',
      '- Write the structure and <style> first and the <script> last. Scripts run once the call settles, after the markup is final.',
      '- The preview runs sandboxed: no fetch/XHR/WebSocket, no same-origin DOM access, no navigation, no popups. Remote images, fonts, and scripts from jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, and esm.sh are allowed; inline <script> is allowed.',
      '- The preview inherits the application theme. Style with the host variables --dsw-alias-bg-base, --dsw-alias-label-primary, --dsw-alias-label-secondary, --dsw-alias-border-l2, --dsw-radius-lg, or the aliases --color-background-primary, --color-text-primary, --color-border, --color-accent, --color-danger. Never hard-code a white background or black text: light and dark themes must both read correctly. A transparent background is best.',
      '- Give the outermost container a natural, content-driven height (never 100vh or a fixed pixel height) and avoid position: fixed; the card measures the content and grows with it. Tall previews stay scrollable and expandable.',
      '',
      'One rich preview beats several small ones. After calling this tool, do not paste the markup into your reply — describe what the user is looking at instead.',
    ].join('\n'),
    parameters: {
      html: {
        type: 'string',
        required: true,
        description: 'The HTML fragment to render (inline <style> and <script> allowed).',
      },
      title: {
        type: 'string',
        description: 'Short human-readable card title, e.g. "Radix sort animation".',
      },
      height: {
        type: 'number',
        description: 'Initial visible height in CSS pixels (120-2400, default 620). Taller content scrolls inside the preview and the user can expand the card.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          characters: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render(args, value) {
        return [{
          type: 'text',
          text: `Rendered the HTML preview "${value.title}" (${describeSize(value.characters)}) in the conversation. The user sees it live; do not repeat the markup in your reply.`,
        }];
      },
      presentationMeta(args, value) {
        return {
          title: value.title,
          characters: value.characters,
          bytes: value.bytes,
        };
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const html = typeof args.html === 'string' ? args.html : '';
      if (html.trim().length === 0) throw new Error('render_html requires non-empty html');
      if (html.length > MAX_HTML_CHARS) {
        throw new Error(`render_html accepts at most ${MAX_HTML_CHARS} characters of HTML (got ${html.length}). Split the visualization into smaller previews, or move shared data into a CDN script.`);
      }
      const title = normalizeTitle(args.title) ?? 'HTML preview';
      const characters = html.length;
      const bytes = Buffer.byteLength(html, 'utf8');
      return { title, characters, bytes };
    },
  }));
}
