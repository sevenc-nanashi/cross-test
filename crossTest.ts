import { crossTestRunner } from "./crossTestRunner.ts";

const crossTestHost = await import("./crossTestHost.ts")
  .then((m) => m.crossTestHost)
  .catch(() => {
    return () => {
      throw new Error("Unavailable");
    };
  });

export type Platform = "node" | "browser" | "deno" | "cfWorkers" | "bun";
export type TestOptions = {
  platforms: Platform[];
};

export const crossTest = (file: string, options: TestOptions) => {
  if (typeof Deno !== "undefined" && Deno.version) {
    return crossTestHost({
      file,
      options,
    });
  }

  return crossTestRunner();
};
