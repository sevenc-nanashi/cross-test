import { crossTestRunner as nodeRunner } from "./runtimes/nodeLikeRunner.ts";
import * as host from "./host.deno.ts";

export type Runtime = "node" | "browser" | "deno" | "cfWorkers" | "bun";
export type TestOptions = {
  runtimes: Runtime[];
};

export const createCrossTest = async (file: string, options: TestOptions) => {
  if (typeof Deno !== "undefined" && Deno.version) {
    const key = "crossTestHost" as string;
    // @ts-expect-error Some hack to remove esbuild warning
    return await host[key]({
      file,
      options,
    });
  }

  // @ts-expect-error Use if `process` is defined to check if we are in node
  if (typeof process !== "undefined") {
    return nodeRunner();
  }

  throw new Error("Unsupported runtime");
};
