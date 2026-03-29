import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * Browser tool — controls a web browser via Playwright.
 *
 * Playwright is loaded dynamically at runtime. The host can provide a browser
 * connection via BROWSER_WS_ENDPOINT env var, or Playwright will attempt to
 * launch a local Chromium.
 */
export const browserTool: BuiltinTool = {
  definition: {
    name: "browser",
    description:
      "Control a web browser (status/start/stop/tabs/open/snapshot/screenshot/navigate/act). " +
      "Supports Playwright-based browser automation with actions like click, type, press, hover, " +
      "drag, select, fill, resize, wait, and evaluate.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Browser action: status, start, stop, profiles, tabs, open, focus, close, " +
            "snapshot, screenshot, navigate, console, act.",
        },
        profile: {
          type: "string",
          description: 'Browser profile. Default "openclaw" for isolated browser.',
        },
        url: {
          type: "string",
          description: "URL for open/navigate actions.",
        },
        targetId: {
          type: "string",
          description: "Tab/target ID for tab-specific actions.",
        },
        refs: {
          type: "string",
          description: 'Reference format for snapshot: "role" (default) or "aria".',
        },
        fullPage: {
          type: "boolean",
          description: "Take full-page screenshot.",
        },
        kind: {
          type: "string",
          description: "Action kind for act: click, type, press, hover, drag, select, fill, resize, wait, evaluate, close.",
        },
        ref: {
          type: "string",
          description: "Element reference from snapshot.",
        },
        element: {
          type: "string",
          description: "Human-readable element description.",
        },
        text: {
          type: "string",
          description: "Text to type or wait for.",
        },
        key: {
          type: "string",
          description: "Key to press.",
        },
        submit: {
          type: "boolean",
          description: "Press Enter after typing.",
        },
        slowly: {
          type: "boolean",
          description: "Type one character at a time.",
        },
        selector: {
          type: "string",
          description: "CSS selector for element targeting.",
        },
        doubleClick: {
          type: "boolean",
          description: "Double-click instead of single click.",
        },
        button: {
          type: "string",
          description: "Mouse button: left, right, middle.",
        },
        modifiers: {
          type: "array",
          items: { type: "string" },
          description: "Modifier keys to hold during action.",
        },
        startRef: {
          type: "string",
          description: "Start element ref for drag.",
        },
        endRef: {
          type: "string",
          description: "End element ref for drag.",
        },
        values: {
          type: "array",
          items: { type: "string" },
          description: "Values for select action.",
        },
        fields: {
          type: "array",
          items: { type: "object" },
          description: "Fields for fill action.",
        },
        width: {
          type: "number",
          description: "Width for resize.",
        },
        height: {
          type: "number",
          description: "Height for resize.",
        },
        fn: {
          type: "string",
          description: "JavaScript function string for evaluate.",
        },
        textGone: {
          type: "string",
          description: "Text to wait for disappearance.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds.",
        },
        accept: {
          type: "boolean",
          description: "Accept/reject dialog.",
        },
        promptText: {
          type: "string",
          description: "Text for prompt dialog.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths for upload.",
        },
        level: {
          type: "string",
          description: "Console message level filter.",
        },
        compact: {
          type: "boolean",
          description: "Compact snapshot output.",
        },
        interactive: {
          type: "boolean",
          description: "Include interactive elements only in snapshot.",
        },
      },
      required: ["action"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const action = input.action as string;

    // Try to load Playwright dynamically — it's an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pw: any = null;
    try {
      pw = await import("playwright");
    } catch {
      // Playwright not installed
    }

    if (!pw) {
      return {
        content: JSON.stringify({
          error: "playwright_not_available",
          message:
            "Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium",
          action,
        }),
        isError: true,
      };
    }

    // Get or create browser state (singleton)
    const state = getBrowserState();

    try {
      switch (action) {
        case "status":
          return {
            content: JSON.stringify({
              running: state.browser !== null && state.browser.isConnected(),
              pages: state.page ? 1 : 0,
            }),
          };

        case "start": {
          if (!state.browser || !state.browser.isConnected()) {
            const env = ctx.env ?? process.env;
            const wsEndpoint = env.BROWSER_WS_ENDPOINT;
            if (wsEndpoint) {
              state.browser = await pw.chromium.connect(wsEndpoint);
            } else {
              state.browser = await pw.chromium.launch({ headless: true });
            }
            const context = await state.browser.newContext();
            state.page = await context.newPage();
          }
          return { content: JSON.stringify({ status: "started" }) };
        }

        case "stop": {
          if (state.browser) {
            await state.browser.close();
            state.browser = null;
            state.page = null;
          }
          return { content: JSON.stringify({ status: "stopped" }) };
        }

        case "open": {
          await ensureBrowser(pw, ctx, state);
          const url = input.url as string;
          if (!url) return { content: "Error: url is required for open.", isError: true };
          await state.page!.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          return {
            content: JSON.stringify({
              url: state.page!.url(),
              title: await state.page!.title(),
            }),
          };
        }

        case "navigate": {
          await ensureBrowser(pw, ctx, state);
          const url = input.url as string;
          if (!url) return { content: "Error: url is required for navigate.", isError: true };
          await state.page!.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          return {
            content: JSON.stringify({
              url: state.page!.url(),
              title: await state.page!.title(),
            }),
          };
        }

        case "snapshot": {
          await ensureBrowser(pw, ctx, state);
          const page = state.page!;
          const title = await page.title();
          const snapUrl = page.url();
          let ariaTree: string;
          try {
            ariaTree = await page.locator("body").ariaSnapshot();
          } catch {
            ariaTree = "(aria snapshot not available)";
          }
          return {
            content: JSON.stringify({ url: snapUrl, title, snapshot: ariaTree }, null, 2),
          };
        }

        case "screenshot": {
          await ensureBrowser(pw, ctx, state);
          const fullPage = input.fullPage === true;
          const buf = await state.page!.screenshot({ fullPage, type: "png" });
          return {
            content: JSON.stringify({
              screenshot: buf.toString("base64"),
              encoding: "base64",
              type: "png",
              url: state.page!.url(),
            }),
          };
        }

        case "tabs": {
          await ensureBrowser(pw, ctx, state);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pages = state.browser!.contexts().flatMap((c: any) => c.pages());
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tabs = pages.map((p: any, i: number) => ({
            index: i,
            url: p.url(),
            title: p.url(), // title() is async, use url as fallback
          }));
          return { content: JSON.stringify(tabs) };
        }

        case "console": {
          return { content: JSON.stringify({ messages: state.consoleLogs.slice(-50) }) };
        }

        case "act": {
          await ensureBrowser(pw, ctx, state);
          return await executeAction(state.page!, input);
        }

        default:
          return { content: `Unknown browser action: ${action}`, isError: true };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: JSON.stringify({ error: "browser_error", message: msg, action }), isError: true };
    }
  },
};

// ---------------------------------------------------------------------------
// Browser state management (singleton)
// ---------------------------------------------------------------------------

interface BrowserState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browser: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
  consoleLogs: string[];
}

let _state: BrowserState | null = null;

function getBrowserState(): BrowserState {
  if (!_state) {
    _state = { browser: null, page: null, consoleLogs: [] };
  }
  return _state;
}

async function ensureBrowser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pw: any,
  ctx: BuiltinToolContext,
  state: BrowserState,
): Promise<void> {
  if (!state.browser || !state.browser.isConnected()) {
    const env = ctx.env ?? process.env;
    const wsEndpoint = env.BROWSER_WS_ENDPOINT;
    if (wsEndpoint) {
      state.browser = await pw.chromium.connect(wsEndpoint);
    } else {
      state.browser = await pw.chromium.launch({ headless: true });
    }
    const context = await state.browser.newContext();
    state.page = await context.newPage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.page.on("console", (msg: any) => {
      state.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      if (state.consoleLogs.length > 200) state.consoleLogs.shift();
    });
  }
}

async function executeAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  input: Record<string, unknown>,
): Promise<BuiltinToolResult> {
  const kind = input.kind as string;
  if (!kind) return { content: "Error: kind is required for act.", isError: true };

  switch (kind) {
    case "click": {
      const ref = (input.ref || input.selector) as string;
      if (!ref) return { content: "Error: ref or selector required for click.", isError: true };
      const opts: Record<string, unknown> = {};
      if (input.button) opts.button = input.button;
      if (input.doubleClick) opts.clickCount = 2;
      await page.click(ref, opts);
      return { content: JSON.stringify({ kind: "click", ref, done: true }) };
    }

    case "type": {
      const ref = (input.ref || input.selector) as string;
      if (!ref) return { content: "Error: ref or selector required for type.", isError: true };
      const text = input.text as string;
      await page.fill(ref, text);
      if (input.submit) await page.press(ref, "Enter");
      return { content: JSON.stringify({ kind: "type", ref, done: true }) };
    }

    case "press": {
      const key = input.key as string;
      if (!key) return { content: "Error: key required for press.", isError: true };
      await page.keyboard.press(key);
      return { content: JSON.stringify({ kind: "press", key, done: true }) };
    }

    case "hover": {
      const ref = (input.ref || input.selector) as string;
      if (!ref) return { content: "Error: ref or selector required for hover.", isError: true };
      await page.hover(ref);
      return { content: JSON.stringify({ kind: "hover", ref, done: true }) };
    }

    case "evaluate": {
      const fn = input.fn as string;
      if (!fn) return { content: "Error: fn required for evaluate.", isError: true };
      const result = await page.evaluate(fn);
      return { content: JSON.stringify({ kind: "evaluate", result }) };
    }

    case "wait": {
      if (input.text) {
        await page.waitForSelector(`text=${input.text as string}`, {
          timeout: (input.timeoutMs as number) ?? 30_000,
        });
      } else if (input.textGone) {
        await page.waitForSelector(`text=${input.textGone as string}`, {
          state: "hidden",
          timeout: (input.timeoutMs as number) ?? 30_000,
        });
      } else if (input.url) {
        await page.waitForURL(input.url as string, { timeout: (input.timeoutMs as number) ?? 30_000 });
      }
      return { content: JSON.stringify({ kind: "wait", done: true }) };
    }

    case "resize": {
      const width = input.width as number;
      const height = input.height as number;
      if (!width || !height) return { content: "Error: width and height required.", isError: true };
      await page.setViewportSize({ width, height });
      return { content: JSON.stringify({ kind: "resize", width, height, done: true }) };
    }

    case "select": {
      const ref = (input.ref || input.selector) as string;
      const values = input.values as string[];
      if (!ref || !values) return { content: "Error: ref and values required.", isError: true };
      await page.selectOption(ref, values);
      return { content: JSON.stringify({ kind: "select", ref, values, done: true }) };
    }

    default:
      return { content: `Unknown act kind: ${kind}`, isError: true };
  }
}
