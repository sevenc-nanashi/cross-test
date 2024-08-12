import { dirname, fromFileUrl } from "@std/path";
import { debug } from "../debug.ts";
import { Lock } from "@core/asyncutil/lock";
import type { Runtime } from "../crossTest.ts";

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

const exists = async (path: string): Promise<boolean> => {
  return await Deno.stat(fromFileUrl(path))
    .then(() => true)
    .catch(() => false);
};
export const findDenoJson = async (
  path: string,
): Promise<string | undefined> => {
  if (await exists(`${path}/deno.jsonc`)) {
    return fromFileUrl(`${path}/deno.jsonc`);
  }
  if (await exists(`${path}/deno.json`)) {
    return fromFileUrl(`${path}/deno.json`);
  }
  if (dirname(path) === path) {
    return undefined;
  }
  return await findDenoJson(dirname(path));
};

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
const deserializeError = (error: SerializedError): Error => {
  if (error.type === "error") {
    const e = new Error(error.message);
    e.name = error.name;
    e.stack = error.stack;
    return e;
  }
  return new Error(String(error.value));
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

  constructor(runtime: Runtime) {
    this.runtime = runtime;

    this.server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
      switch (req.method) {
        case "GET": {
          return new Response(this.messageStream, {
            headers: {
              "Content-Type": "plain/text",
            },
          });
        }
        case "POST": {
          try {
            const data: ToHostMessage = await req.json();

            this.onMessage(data);

            return new Response(null, { status: 204 });
          } catch (e) {
            this.server.shutdown();
            await this.cleanup(e);
            return new Response(e.message, { status: 500 });
          }
        }
        default:
          return new Response(null, { status: 405 });
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
    debug(`Panic: ${e.stack}`);
    for (const { reject } of this.runnerStepPromises.values()) {
      reject(e);
    }
    for (const test of this.tests.values()) {
      test.reject(e);
    }
    await this.cleanup(e);
  }

  abstract cleanup(e: Error | undefined): Promise<void>;
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

  startTest(testId: number) {
    this.send({ type: "run", testId });
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
