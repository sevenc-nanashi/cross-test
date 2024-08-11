import { crossTestRunner } from "./crossTestRunner.ts";

const crossTestEntry = await import("./crossTestEntry.ts")
  .then((m) => m.crossTestEntry)
  .catch(() => {
    return () => {
      throw new Error("Unavailable");
    };
  });

type RuntimeType = "node" | "browser" | "deno" | "cfWorkers" | "bun";
export type TestOptions = {
  platforms: RuntimeType[];
};

export const crossTest = (file: string, options: TestOptions) => {
  if (typeof Deno !== "undefined" && Deno.version) {
    return crossTestEntry({
      file,
      options,
    });
  }

  return crossTestRunner();
};
