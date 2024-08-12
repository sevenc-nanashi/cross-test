import type { TestOptions } from "./crossTest.ts";
import { debug } from "./debug.ts";
import { NodeLikeRunnerController } from "./runtimes/nodeLike.ts";

type Controllers = {
  deno: undefined;
  node: NodeLikeRunnerController;
  bun: NodeLikeRunnerController;
  browser: undefined;
  cfWorkers: undefined;
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
              switch (runtime) {
                case "node":
                case "bun":
                  await controllers[runtime].runTest(testId, t);
                  break;
              }
            },
          );
        }
      }
    };
  };
};
