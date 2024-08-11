import { crossTestRunner } from "./crossTestRunner.ts";
import type { crossTestHost } from "./crossTestHost.ts";

const maybeCrossTestHost = await import("./crossTestHost.ts")
  .then((m) => m.crossTestHost as typeof crossTestHost)
  .catch((e) => {
    return () => {
      throw new Error(
        `Unavailable in this context, possibly library bug: ${e}`,
      );
    };
  });

export type Platform = "node" | "browser" | "deno" | "cfWorkers" | "bun";
export type TestOptions = {
  platforms: Platform[];
};

export const createCrossTest = (file: string, options: TestOptions) => {
  if (typeof Deno !== "undefined" && Deno.version) {
    if (
      Deno.permissions.querySync({ name: "read", path: "<PWD>" }).state !==
      "granted"
    ) {
      throw new Error("You need --allow-read to run tests");
    }
    return maybeCrossTestHost({
      file,
      options,
    });
  }

  return crossTestRunner();
};
