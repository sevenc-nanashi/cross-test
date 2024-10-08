import type { CrossTestRegistrar, TestOptions } from "./crossTest.ts";
import { debug } from "./debug.ts";
import type { CrossTestRegistrarArgs } from "./internal.ts";
import { BrowserRunnerController } from "./runtimes/browser.ts";
import { NodeLikeRunnerController } from "./runtimes/nodeLike.ts";
import { WorkerdRunnerController } from "./runtimes/workerd.ts";

type Controllers = {
  deno: undefined;
  node: NodeLikeRunnerController;
  bun: NodeLikeRunnerController;
  workerd: WorkerdRunnerController;
  browser: BrowserRunnerController;
};

export const crossTestHost = async ({
  file,
  options,
}: {
  file: string;
  options: TestOptions;
}): Promise<CrossTestRegistrar> => {
  const controllers: Partial<Controllers> = {};
  for (const runtime of options.runtimes) {
    switch (runtime) {
      case "deno":
        break;
      case "node":
      case "bun": {
        controllers[runtime] = await NodeLikeRunnerController.create(
          file,
          runtime,
        );
        break;
      }
      case "workerd":
        controllers[runtime] = await WorkerdRunnerController.create(file);
        break;
      case "browser":
        controllers[runtime] = await BrowserRunnerController.create(file);
        break;
      default:
        throw new Error(`Unsupported runtime: ${runtime}`);
    }
  }

  let nextTestId = 0;

  return (...args: CrossTestRegistrarArgs) => {
    let name: string;
    let testOptions: Omit<Deno.TestDefinition, "name" | "fn" | "sanitizeOps">;
    let testFn: Deno.TestStepDefinition["fn"];
    if (args.length === 2) {
      [name, testFn] = args;
      testOptions = {};
    } else if (args.length === 3) {
      [name, testOptions, testFn] = args;
    } else {
      throw new Error("Invalid number of arguments");
    }
    Deno.test(name, { ...testOptions, sanitizeOps: false }, async (t) => {
      const testId = nextTestId++;
      debug(`Test registered: ${file}[${testId}]`);
      for (const runtime of options.runtimes) {
        if (runtime === "deno") {
          await t.step("Deno", testFn);
        } else {
          await t.step(
            `${runtime[0].toUpperCase()}${runtime.slice(1)}`,
            async (t) => {
              if (!controllers[runtime]) {
                throw new Error(`No controller for ${runtime}, unreachable`);
              }
              await controllers[runtime].runTest(testId, t);
            },
          );
        }
      }
    });
  };
};
