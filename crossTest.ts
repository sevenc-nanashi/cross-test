import { crossTestRunner } from "./crossTestRunner.ts";

const crossTestHost = await import("./crossTestHost.ts")
  .then((m) => m.crossTestHost)
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
    return crossTestHost({
      file,
      options,
    });
  }

  return crossTestRunner();
};
