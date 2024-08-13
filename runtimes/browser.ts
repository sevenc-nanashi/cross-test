import {
  basePrepareJs,
  createDistRoot,
  deserializeError,
  RunnerController,
} from "./base.ts";
import * as astral from "@astral/astral";
import { TextLineStream } from "@std/streams";
import dir from "dir/mod.ts";
import { prelude } from "./runner.ts";
import { debug, isDebug } from "../debug.ts";
import type { InitialParentData } from "./base.ts";
import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { Lock } from "@core/asyncutil/lock";
import { AsyncValue } from "@core/asyncutil/async-value";

const prepareJs = async (file: string) => {
  const preludeCode = [
    `const __crosstestPrelude = (${prelude.toString()})()`,
    "const Deno = { test: __crosstestPrelude.prepareDenoTest() }",
  ].join("\n");
  const outroCode = `window.__crosstestRun = __crosstestPrelude.outro`;
  const outPath = await basePrepareJs(file, "browser", {
    prelude: preludeCode,
    outro: outroCode,
  });

  return outPath;
};

export class BrowserRunnerController extends RunnerController {
  browserPage: astral.Page;

  static async create(file: string) {
    const path = await prepareJs(file);
    const page = await createPage(path);

    return new BrowserRunnerController(file, page);
  }

  constructor(file: string, browserPage: astral.Page) {
    super("browser");

    this.browserPage = browserPage;
    browserPage
      .evaluate(
        (parentData) =>
          // @ts-expect-error using unsafe api
          // deno-lint-ignore no-window
          window.__crosstestRun ? window.__crosstestRun(parentData) : "noRun",
        {
          args: [
            {
              file,
              isDebug: isDebug(),
              runtime: "browser",
              server: `http://localhost:${this.server.addr.port}`,
            },
          ],
        },
      )
      .then((result) => {
        if (result === "noRun") {
          this.panic(
            new Error(
              "No test run function found, possibly due to invalid import",
            ),
          );
        }
      })
      .catch((e) => {
        this.panic(e);
      });
  }

  async cleanup(e: Error | undefined): Promise<void> {
    await this.browserPage.close();
    super.cleanup(e);
  }
}

const browser = new Lock(new AsyncValue<astral.Browser | undefined>(undefined));
const pages = new Map<string, string>();
let pageServer: Deno.HttpServer<Deno.NetAddr> | undefined;

const getBrowser = async () => {
  return await browser.lock(async (browser) => {
    if (await browser.get()) {
      return (await browser.get())!;
    }
    const browserInner = await astral.launch();
    globalThis.addEventListener("unload", async () => {
      debug("Closing browser");
      pageServer?.shutdown();
      await browserInner.close();
    });
    await browser.set(browserInner);
    pageServer = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      const url = new URL(req.url);
      debug(`Request: ${url.pathname}`);
      if (pages.get(url.pathname.slice(1)) === undefined) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(pages.get(url.pathname.slice(1))!, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    return browserInner;
  });
};

const createPage = async (path: string): Promise<astral.Page> => {
  const browser = await getBrowser();
  const html = [
    `<!DOCTYPE html>`,
    `<html>`,
    `  <head>`,
    `    <meta charset="utf-8">`,
    `    <title>Test</title>`,
    `    <script type="module">`,
    await Deno.readTextFile(path),
    `    </script>`,
    `  </head>`,
    `  <body>`,
    `  </body>`,
    `</html>`,
  ].join("\n");
  const nonce = crypto.randomUUID();
  pages.set(nonce, html);

  const page = await browser.newPage();
  await page.goto(`http://localhost:${pageServer!.addr.port}/${nonce}`);
  debug(`Page created: http://localhost:${pageServer!.addr.port}/${nonce}`);

  return page;
};
