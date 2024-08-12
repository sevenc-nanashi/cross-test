import { Lock } from "@core/asyncutil/lock";
import { join } from "@std/path";
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as runner from "./crossTestRunner.ts";
import type { TestOptions } from "./crossTest.ts";
import { debug, isDebug } from "./debug.ts";

const distRoot = join(Deno.cwd(), ".anytest_temp");

let denoJsonPath: string;
const getDenoJsonPath = async () => {
  if (denoJsonPath) {
    return denoJsonPath;
  }
  if (await Deno.stat(join(Deno.cwd(), "deno.jsonc")).catch(() => false)) {
    denoJsonPath = join(Deno.cwd(), "deno.jsonc");
    return denoJsonPath;
  }
  if (await Deno.stat(join(Deno.cwd(), "deno.json")).catch(() => false)) {
    denoJsonPath = join(Deno.cwd(), "deno.json");
    return denoJsonPath;
  }
};

const hash = async (data: string) => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const preparedJsFiles = new Lock(new Map<string, string>());
const prepareJs = async (file: string) => {
  return await preparedJsFiles.lock(async (map) => {
    if (map.has(file)) {
      debug(`Cache hit: ${file}`);
      return map.get(file)!;
    }
    debug(`Cache miss: ${file}`);
    const outfile = join(distRoot, `entry-${await hash(file)}.mjs`);
    await esbuild.build({
      entryPoints: [file],
      format: "esm",
      bundle: true,
      sourcemap: true,
      minify: !isDebug(),
      external: ["*/crossTestHost.ts"],
      outfile,
      banner: {
        js: [
          `const __anytestPrelude = (${runner.prelude.toString()})()`,
          "await __anytestPrelude.prelude();",
          "const Deno = { test: __anytestPrelude.prepareDenoTest() }",
        ].join(";"),
      },
      footer: {
        js: `__anytestPrelude.outro();`,
      },
      plugins: denoPlugins({
        configPath: await getDenoJsonPath(),
      }),
    });
    map.set(file, outfile);

    await esbuild.stop();
    debug(`Prepared: ${file} -> ${outfile}`);

    return outfile;
  });
};

let globalId = 0;
export const crossTestHost = ({
  file,
  options,
}: {
  file: string;
  options: TestOptions;
}) => {
  return (test: Deno.TestStepDefinition["fn"]): Deno.TestDefinition["fn"] => {
    return async (t: Deno.TestContext) => {
      const thisId = globalId++;
      const path = await prepareJs(file);
      debug(`Test registered: ${file}[${thisId}]`);
      for (const runtime of options.runtimes) {
        if (runtime === "deno") {
          await t.step("Deno", test);
        }
        if (["node", "bun", "cfWorkers"].includes(runtime)) {
          await t.step(
            `${runtime[0].toUpperCase()}${runtime.slice(1)}`,
            async (t) => {
              let commandArgs: string[];
              if (runtime === "bun") {
                commandArgs = ["bun", "run", path];
              } else if (["node", "cfWorkers"].includes(runtime)) {
                commandArgs = ["node", "--enable-source-maps", path];
              } else {
                throw new Error(`Unreachable: ${runtime}`);
              }

              const { promise: serverPromise, resolve: resolveServer } =
                Promise.withResolvers<
                  runner.TestMessage & { type: "pass" | "fail" }
                >();

              const runnerStepPromises = new Map<
                string,
                {
                  resolve: () => void;
                  reject: (error: Error) => void;
                  promise: Promise<void>;
                }
              >();
              const hostStepPromises = new Map<string, Promise<boolean>>();
              const testStepContexts = new Map<string, Deno.TestContext>();
              const server = Deno.serve(
                { port: 0, onListen: () => {} },
                async (req) => {
                  const data: runner.TestMessage = await req.json();
                  debug(`Received: ${JSON.stringify(data)}`);
                  switch (data.type) {
                    case "pass":
                    case "fail":
                      server.shutdown();
                      resolveServer(data);
                      break;
                    case "stepStart": {
                      const { promise, resolve, reject } =
                        Promise.withResolvers<void>();
                      const nonce = crypto.randomUUID();
                      runnerStepPromises.set(nonce, {
                        promise,
                        resolve,
                        reject,
                      });
                      let context: Deno.TestContext | undefined;
                      if (!data.parent) {
                        context = t;
                      } else {
                        context = testStepContexts.get(data.parent);
                      }
                      if (!context) {
                        server.shutdown();
                        resolveServer({
                          type: "fail",
                          error: `Invalid parent: ${data.parent}`,
                        });
                        return new Response("");
                      }
                      hostStepPromises.set(
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
                                testStepContexts.set(nonce, t);

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
                      const runnerStepPromise = runnerStepPromises.get(
                        data.nonce,
                      );
                      if (!runnerStepPromise) {
                        server.shutdown();
                        resolveServer({
                          type: "fail",
                          error: `Invalid nonce: ${data.nonce}`,
                        });
                        return new Response("");
                      }
                      runnerStepPromise.resolve();

                      break;
                    }
                    case "stepFail": {
                      const runnerStepPromise = runnerStepPromises.get(
                        data.nonce,
                      );
                      if (!runnerStepPromise) {
                        server.shutdown();
                        resolveServer({
                          type: "fail",
                          error: `Invalid nonce: ${data.nonce}`,
                        });
                        return new Response("");
                      }

                      runnerStepPromise.reject(new Error(data.error));
                      break;
                    }

                    default:
                      server.shutdown();
                      resolveServer({
                        type: "fail",
                        error: `Invalid payload: ${JSON.stringify(data)}`,
                      });
                  }

                  return new Response("");
                },
              );

              const payload: runner.TestPayload = {
                id: thisId,
                runtime,
                file,
                server: `http://localhost:${server.addr.port}`,
              };

              debug(`Running: ${commandArgs.join(" ")}`);
              debug(`Payload: ${JSON.stringify(payload)}`);

              const command = new Deno.Command(commandArgs[0], {
                args: commandArgs.slice(1),
                env: {
                  ...Deno.env.toObject(),
                  ANYTEST_PAYLOAD: JSON.stringify(payload),
                },
                stdout: "inherit",
                stderr: "inherit",
              });

              const process = command.spawn();
              const status = await process.status;
              if (!status.success) {
                server.shutdown();
                throw new Error(`Initial process failed: Exit code ${status.code}`);
              }
              const result = await serverPromise;
              if (result.type === "fail") {
                throw new Error(result.error);
              }
            },
          );
        }
      }
    };
  };
};
