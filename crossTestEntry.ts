import { Lock } from "@core/asyncutil/lock";
import { afterAll } from "@std/testing/bdd";
import { join } from "@std/path";
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { RunnerController } from "./runnerController.ts";
import * as runner from "./crossTestRunner.ts";
import type { TestOptions } from "./crossTest.ts";

type RuntimeType = "node" | "browser" | "deno" | "cfWorkers" | "bun";

const distRoot = join(Deno.cwd(), ".anytest_temp");
const runnerControllers = new Map<
  string,
  Lock<Map<RuntimeType, RunnerController>>
>();

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

let isCallbackRegistered = false;

const prepareRunners = async (file: string, platforms: RuntimeType[]) => {
  if (!isCallbackRegistered) {
    afterAll(async () => {
      console.info("Closing runners...");
      for (const [_, lock] of runnerControllers) {
        await lock.lock(async (map) => {
          for (const process of map.values()) {
            await process.close();
          }
        });
      }

      await esbuild.stop();
    });
    isCallbackRegistered = true;
  }
  const runnerController = runnerControllers.get(file);
  if (!runnerController) {
    const lock = new Lock(new Map());
    runnerControllers.set(file, lock);
  }
  const outfile = join(distRoot, `entry-${await hash(file)}.mjs`);
  await esbuild.build({
    entryPoints: [file],
    format: "esm",
    bundle: true,
    minify: false,
    external: ["*/crossTestEntry.ts"],
    outfile,
    banner: {
      js: `(${runner.prelude.toString()})()`,
    },
    footer: {
      js: `await (${runner.outro.toString()})()`,
    },
    plugins: denoPlugins({
      configPath: await getDenoJsonPath(),
    }),
  });
  await runnerControllers.get(file)!.lock(async (map) => {
    for (const platform of platforms) {
      if (platform === "deno") {
        continue;
      }
      if (map.has(platform)) {
        continue;
      }
      let command: string[] = [];
      switch (platform) {
        case "node": {
          command = ["node", outfile];
          break;
        }
        case "bun": {
          command = ["bun", outfile];
          break;
        }
        default: {
          throw new Error("Not implemented");
        }
      }
      map.set(platform, new RunnerController(command));
    }
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
      await prepareRunners(file, options.platforms);
      for (const platform of options.platforms) {
        if (platform === "deno") {
          await t.step("Deno", test);
        }
        if (platform === "node" || platform === "bun") {
          await t.step(
            `${platform[0].toUpperCase()}${platform.slice(1)}`,
            async () => {
              await runnerControllers.get(file)!.lock(async (map) => {
                const process = map.get(platform);
                if (!process) {
                  throw new Error("No process found");
                }
                const payload = {
                  type: "run",
                  id: thisId,
                };
                const result = (await process.send(payload)) as
                  | {
                      type: "success";
                    }
                  | {
                      type: "error";
                      error: string;
                    };
                if (result.type === "error") {
                  throw new Error(result.error);
                }
              });
            },
          );
        }
      }
    };
  };
};
