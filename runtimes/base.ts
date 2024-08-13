import { dirname, fromFileUrl, join, toFileUrl } from "@std/path";
import * as esbuild from "esbuild";
import { debug, isDebug } from "../debug.ts";
import { Lock } from "@core/asyncutil/lock";
import type { Runtime } from "../crossTest.ts";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { SourceMapConsumer, SourceMapGenerator } from "source-map";

export type DenoTestArgs =
  | [t: Deno.TestDefinition]
  | [fn: Deno.TestStepDefinition["fn"]]
  | [name: string, fn: Deno.TestStepDefinition["fn"]]
  | [
      name: string,
      options: Omit<Deno.TestDefinition, "name" | "fn">,
      fn: Deno.TestStepDefinition["fn"],
    ]
  | [
      options: Omit<Deno.TestDefinition, "fn">,
      fn: Deno.TestStepDefinition["fn"],
    ];

let distRoot: string | undefined;
export const createDistRoot = async () => {
  if (distRoot) {
    return distRoot;
  }

  if (
    Deno.permissions.querySync({
      name: "env",
      variable: "CROSSTEST_TEMPDIST",
    }).state === "granted" &&
    Deno.env.get("CROSSTEST_TEMPDIST")
  ) {
    distRoot = fromFileUrl(
      new URL(
        Deno.env.get("CROSSTEST_TEMPDIST")!,
        toFileUrl(Deno.cwd() + "/."),
      ),
    );
    debug(`Using CROSSTEST_TEMPDIST: ${distRoot}`);
    return distRoot;
  }
  debug("Creating distRoot");
  distRoot = await Deno.makeTempDir();
  await Deno.mkdir(distRoot, { recursive: true });

  globalThis.addEventListener("unload", () => {
    debug(`Cleaning up distRoot: ${distRoot}`);
    Deno.remove(distRoot!, { recursive: true });
  });

  return distRoot;
};

const looseExists = async (
  path: string,
  options: {
    isFile?: boolean;
    isDirectory?: boolean;
  } = {},
) => {
  try {
    const stat = await Deno.stat(path);
    if (options.isFile && !stat.isFile) {
      return false;
    }
    if (options.isDirectory && !stat.isDirectory) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const findDenoJson = async (
  pathOrUrl: string,
): Promise<string | undefined> => {
  const path = pathOrUrl.includes("://") ? fromFileUrl(pathOrUrl) : pathOrUrl;
  if (await looseExists(`${path}/deno.jsonc`, { isFile: true })) {
    return `${path}/deno.jsonc`;
  }
  if (await looseExists(`${path}/deno.json`, { isFile: true })) {
    return `${path}/deno.json`;
  }
  if (dirname(path) === path) {
    return undefined;
  }
  return await findDenoJson(dirname(path));
};

const jsCache = new Lock(new Map<string, string>());

const hash = async (data: string) => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

let esbuildSetup = false;
export const setupEsbuild = () => {
  if (esbuildSetup) {
    return;
  }
  globalThis.addEventListener("unload", () => {
    debug("Stopping esbuild");
    esbuild.stop();
  });
  esbuildSetup = true;
};

export const basePrepareJs = async (
  file: string,
  target: string,
  extras: {
    header?: string;
    prelude?: string;
    outro?: string;
    footer?: string;
  },
) =>
  await jsCache.lock(async (map) => {
    const key = `${file}-${target}`;
    const cached = map.get(key);
    if (cached) {
      debug(`Cache hit: ${file} -> ${cached}`);
      return cached;
    }
    debug(`Cache miss: ${file}`);
    const denoJsonPath = await findDenoJson(file);
    const distRoot = await createDistRoot();

    let header = extras.header ?? "";
    if (extras.prelude) {
      const minifiedPrelude = await esbuild
        .transform(extras.prelude, {
          minify: !isDebug(),
        })
        .then((result) => result.code);
      header += "\n" + minifiedPrelude;
    }
    let footer = extras.footer ?? "";

    if (extras.outro) {
      const minifiedOutro = await esbuild
        .transform(extras.outro, {
          minify: !isDebug(),
        })
        .then((result) => result.code);
      footer = minifiedOutro + "\n" + footer;
    }

    const outfile = join(distRoot, `${await hash(file)}-${target}.mjs`);
    debug(`deno.json/deno.jsonc path: ${denoJsonPath}`);
    setupEsbuild();
    await esbuild.build({
      entryPoints: [file],
      format: "esm",
      bundle: true,
      sourcemap: true,
      minify: !isDebug(),
      outfile,
      banner: {
        js: header,
      },
      footer: {
        js: footer,
      },
      plugins: [
        {
          name: "clearDenoTs",
          setup(build) {
            // deno-lint-ignore require-await
            build.onLoad({ filter: /\.deno\.ts$/ }, async (_args) => {
              return {
                contents: "export {}",
                loader: "ts",
              };
            });
          },
        },
        ...denoPlugins({
          configPath: denoJsonPath,
        }),
      ],
    });
    debug(`Prepared: ${file} -> ${outfile}`);

    const mapPath = `${outfile}.map`;
    const mapData = SourceMapGenerator.fromSourceMap(
      await new SourceMapConsumer(JSON.parse(await Deno.readTextFile(mapPath))),
    );
    for (let line = 0; line < header.split("\n").length; line++) {
      mapData.addMapping({
        source: "cross-test:header",
        generated: { line: line + 1, column: 0 },
        original: { line: 1, column: 0 },
      });
    }
    const finalLines = await Deno.readTextFile(outfile);
    const finalLinesCount = finalLines.split("\n").length;
    for (let line = 0; line < footer.split("\n").length; line++) {
      mapData.addMapping({
        source: "cross-test:footer",
        generated: {
          line: finalLinesCount - footer.split("\n").length + line,
          column: 0,
        },
        original: { line: 1, column: 0 },
      });
    }
    mapData.setSourceContent("cross-test:header", "// Not available");
    mapData.setSourceContent("cross-test:footer", "// Not available");

    await Deno.writeTextFile(mapPath, mapData.toString());

    map.set(key, outfile);

    return outfile;
  });

export type SerializedError =
  | {
      type: "error";
      name: string;
      message: string;
      stack: string | undefined;
    }
  | {
      type: "other";
      value: unknown;
    };
export const deserializeError = (error: SerializedError): Error => {
  if (error.type === "error") {
    const actualStacks = error.stack?.split("\n").slice(1) ?? [];
    // Deno cannot show overridden e.stack, so I use message instead to show the original stack
    const e = new Error(error.message + "\n" + actualStacks.join("\n"));
    e.name = error.name;
    e.stack = error.stack;
    return e;
  }
  return new Error(String(error.value));
};

export type InitialParentData = {
  runtime: Runtime;
  file: string;
  server: string;
  isDebug: boolean;
};
export type ToHostMessage =
  | (
      | {
          type: "pass";
          testId: number;
        }
      | {
          type: "fail";
          testId: number;
          error: SerializedError;
        }
      | {
          type: "stepStart";
          testId: number;
          parent: string | undefined;
          ignore: boolean;
          name: string;
        }
      | {
          type: "stepPass";
          testId: number;
          nonce: string;
        }
      | {
          type: "stepFail";
          testId: number;
          nonce: string;
          error: SerializedError;
        }
    )
  | {
      type: "ready";
    };
export type ToRunnerMessage =
  | {
      type: "run";
      testId: number;
    }
  | {
      type: "exit";
    };

const instances: RunnerController[] = [];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
};

export abstract class RunnerController {
  tests = new Map<
    number,
    {
      context: Deno.TestContext;
      promise: Promise<void>;
      resolve: () => void;
      reject: (error: Error) => void;
    }
  >();
  runnerStepPromises = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      promise: Promise<void>;
    }
  >();
  hostStepPromises = new Map<string, Promise<boolean>>();
  testStepContexts = new Map<string, Deno.TestContext>();

  readyPromise: { promise: Promise<void>; resolve: () => void } =
    Promise.withResolvers();

  server: Deno.HttpServer<Deno.NetAddr>;
  runtime: Runtime;
  messageStream: ReadableStream<Uint8Array>;
  messageStreamPromise: { promise: Promise<void>; resolve: () => void };
  messageStreamController:
    | Lock<ReadableStreamDefaultController<Uint8Array>>
    | undefined;

  panicked: Error | undefined;

  constructor(runtime: Runtime) {
    this.runtime = runtime;

    this.server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
      switch (req.method) {
        case "GET": {
          return new Response(this.messageStream, {
            headers: {
              "Content-Type": "plain/text",
              ...corsHeaders,
            },
          });
        }
        case "POST": {
          try {
            const data: ToHostMessage = await req.json();

            this.onMessage(data);

            return new Response(null, {
              status: 204,
              headers: {
                ...corsHeaders,
              },
            });
          } catch (e) {
            await this.panic(e);
            return new Response(e.message, {
              status: 500,
              headers: { ...corsHeaders },
            });
          }
        }
        default:
          return new Response(null, {
            status: 405,
            headers: { ...corsHeaders },
          });
      }
    });
    this.messageStreamPromise = Promise.withResolvers();
    this.messageStream = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.messageStreamController = new Lock(c);
        this.messageStreamPromise.resolve();
      },
    });

    instances.push(this);
    if (instances.length === 1) {
      globalThis.addEventListener("unload", async () => {
        debug("Cleaning up instances");
        for (const instance of instances) {
          await instance.cleanup(undefined);
        }
      });
    }
  }

  protected async panic(e: Error) {
    debug(`Panic: ${e}`);
    this.panicked = e;
    for (const { reject } of this.runnerStepPromises.values()) {
      reject(e);
    }
    for (const test of this.tests.values()) {
      test.reject(e);
    }
    await this.cleanup(e);
  }

  async cleanup(_e: Error | undefined): Promise<void> {
    this.server.shutdown();
    await this.send({ type: "exit" });
  }
  protected async send(data: ToRunnerMessage) {
    if (!this.messageStreamController) {
      throw new Error("Stream controller not initialized");
    }
    await this.messageStreamController.lock((c) => {
      const payload = JSON.stringify(data) + "\n";
      c.enqueue(new TextEncoder().encode(payload));
    });
  }

  waitForReady(): Promise<void> {
    return this.readyPromise.promise;
  }

  async runTest(testId: number, context: Deno.TestContext) {
    if (this.panicked) {
      throw this.panicked;
    }
    this.send({ type: "run", testId });

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.tests.set(testId, {
      context,
      promise,
      resolve,
      reject,
    });
    await promise;
  }

  onMessage(data: ToHostMessage) {
    this.debug(`Received: ${JSON.stringify(data)}`);
    if (data.type === "ready") {
      this.readyPromise.resolve();
      return;
    }

    const test = this.tests.get(data.testId);
    if (!test) {
      throw new Error(`Invalid id: ${data.testId}`);
    }

    switch (data.type) {
      case "pass":
      case "fail": {
        if (data.type === "pass") {
          test.resolve();
        } else {
          test.reject(deserializeError(data.error));
        }
        break;
      }
      case "stepStart": {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const nonce = crypto.randomUUID();
        this.runnerStepPromises.set(nonce, {
          promise,
          resolve,
          reject,
        });
        let context: Deno.TestContext | undefined;
        if (!data.parent) {
          context = test.context;
        } else {
          context = this.testStepContexts.get(data.parent);
        }
        if (!context) {
          throw new Error(`Invalid parent: ${data.parent}`);
        }
        this.hostStepPromises.set(
          nonce,
          data.ignore
            ? context.step({
                name: data.name,
                ignore: true,
                fn: async () => {},
              })
            : context.step({
                name: data.name,
                fn: async (t) => {
                  this.testStepContexts.set(nonce, t);

                  await promise;
                },
              }),
        );
        return new Response(
          JSON.stringify({
            nonce,
          }),
        );
      }
      case "stepPass": {
        const runnerStepPromise = this.runnerStepPromises.get(data.nonce);
        if (!runnerStepPromise) {
          throw new Error(`Invalid nonce: ${data.nonce}`);
        }
        runnerStepPromise.resolve();

        break;
      }
      case "stepFail": {
        const runnerStepPromise = this.runnerStepPromises.get(data.nonce);
        if (!runnerStepPromise) {
          throw new Error(`Invalid nonce: ${data.nonce}`);
        }

        runnerStepPromise.reject(deserializeError(data.error));
        break;
      }

      default:
        throw new Error(`Invalid type: ${data}`);
    }
  }

  protected debug(message: string) {
    debug(`[${this.runtime}] ${message}`);
  }
}
