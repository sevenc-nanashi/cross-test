import type { TestOptions } from "./crossTest.ts";
import { debug } from "./debug.ts";
import { NodeLikeRunnerController } from "./runtimes/nodeLike.ts";
import { WorkerdRunnerController } from "./runtimes/workerd.ts";

type Controllers = {
  deno: undefined;
  node: NodeLikeRunnerController;
  bun: NodeLikeRunnerController;
  workerd: WorkerdRunnerController;
  browser: undefined;
};

export const crossTestHost = async ({
  file,
  options,
}: {
  file: string;
  options: TestOptions;
}) => {
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
      default:
        throw new Error(`Unsupported runtime: ${runtime}`);
    }
  }

  let nextTestId = 0;

  return (test: Deno.TestStepDefinition["fn"]): Deno.TestDefinition["fn"] => {
    return async (t: Deno.TestContext) => {
      const testId = nextTestId++;
      debug(`Test registered: ${file}[${testId}]`);
      for (const runtime of options.runtimes) {
        if (runtime === "deno") {
          await t.step("Deno", test);
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
    };
  };
};
