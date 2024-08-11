let globalId = 0;

type Global = typeof globalThis & {
  __anytestRunnerCallbacks: Map<number, Deno.TestStepDefinition["fn"]>;
};

export const crossTestRunner = () => {
  return (test: Deno.TestStepDefinition["fn"]) => {
    const localId = globalId++;
    (globalThis as Global).__anytestRunnerCallbacks.set(localId, test);

    return () => {
      throw new Error("Unreachable");
    };
  };
};

declare const __global: { Deno: unknown };
const prelude = () => {
  (globalThis as Global).__anytestRunnerCallbacks = new Map();

  const mockTest = () => {};
  mockTest.skip = () => {};
  mockTest.only = () => {};
  __global.Deno = {
    test: mockTest,
  };
};

export const preludeString  = prelude.toString().replace(/\(\) ?=> ?\{/, "").replace(/\}$/, "").replaceAll("__global.", "const ")

const outro = async () => {
  const process = await import("node:process");
  const payload: {
    id: number;
    server: string;
  } = JSON.parse(process.env.ANYTEST_PAYLOAD!);
  const test = (globalThis as Global).__anytestRunnerCallbacks.get(payload.id);
  if (!test) {
    throw new Error("No test found");
  }
  try {
    // @ts-expect-error
    await test({});
    await fetch(payload.server, {
      method: "POST",
      body: JSON.stringify({
        type: "pass",
      }),
    });
  } catch (e) {
    await fetch(payload.server, {
      method: "POST",
      body: JSON.stringify({
        type: "fail",
        error: String(e),
      }),
    });
  }
};

export const outroString = `await (${outro.toString()})()`;
