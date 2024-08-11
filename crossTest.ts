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
  // @ts-expect-error
  if (!Deno.__isAnytestMock) {
    return crossTestEntry({
      file,
      options,
    });
  }

  return crossTestRunner({
    file,
    options,
  });
};
