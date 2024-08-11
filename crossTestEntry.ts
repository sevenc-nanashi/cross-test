import { Lock } from "@core/asyncutil/lock";
import { join } from "@std/path";
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as runner from "./crossTestRunner.ts";
import type { TestOptions } from "./crossTest.ts";
import { debug, isDebug } from "./debug.ts";

type RuntimeType = "node" | "browser" | "deno" | "cfWorkers" | "bun";

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
      minify: !isDebug(),
      external: ["*/crossTestEntry.ts"],
      outfile,
      banner: {
        js: runner.preludeString,
      },
      footer: {
        js: runner.outroString,
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
export const crossTestEntry = ({
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
      for (const platform of options.platforms) {
        if (platform === "deno") {
          await t.step("Deno", test);
        }
        if (platform === "node" || platform === "bun") {
          await t.step(
            `${platform[0].toUpperCase()}${platform.slice(1)}`,
            async () => {
              let commandArgs: string[];
              if (platform === "node") {
                commandArgs = ["node", path];
              } else {
                commandArgs = ["bun", path];
              }

              const { promise: serverPromise, resolve: resolveServer } =
                Promise.withResolvers<
                  | {
                      type: "pass";
                    }
                  | {
                      type: "fail";
                      error: string;
                    }
                >();
              const server = Deno.serve(
                { port: 0, onListen: () => {} },
                async (req) => {
                  const data = await req.json();
                  server.shutdown();
                  resolveServer(data);

                  return new Response("");
                },
              );

              const payload = {
                id: thisId,
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
                throw new Error(`Initial process failed: ${status.code}`);
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
