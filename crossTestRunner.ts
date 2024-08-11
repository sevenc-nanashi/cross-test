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

type DenoTestArgs =
  | [t: Deno.TestDefinition]
  | [fn: Deno.TestStepDefinition["fn"]]
  | [name: string, fn: Deno.TestStepDefinition["fn"]]
  | [
      name: string,
      options: Omit<Deno.TestDefinition, "name" | "fn">,
      fn: Deno.TestStepDefinition["fn"],
    ]
  | [
      options: Omit<Deno.TestDefinition, "fn">,
      fn: Deno.TestStepDefinition["fn"],
    ];

export const prelude = (): {
  prepareDenoTest: () => unknown;
  outro: () => Promise<void>;
} => {
  (globalThis as Global).__anytestRunnerCallbacks = new Map();
  const resolveTestArgs = (args: DenoTestArgs) => {
    let name: string | undefined;
    let options: Omit<Deno.TestDefinition, "name" | "fn">;
    let fn: Deno.TestStepDefinition["fn"];
    if (args.length === 1) {
      if (typeof args[0] === "function") {
        name = undefined;
        options = {};
        [fn] = args;
      } else {
        name = args[0].name;
        options = args[0];
        fn = args[0].fn;
      }
    } else if (args.length === 2) {
      if (typeof args[0] === "string") {
        [name, fn] = args;
        options = {};
      } else {
        [options, fn] = args;
        name = undefined;
      }
    } else {
      [name, options, fn] = args;
    }

    name ??= fn.name;

    return { name, options, fn };
  };

  return {
    prepareDenoTest: () => {
      const mockTest = (...args: DenoTestArgs) => {
        const { name, options, fn } = resolveTestArgs(args);
        const wrappedFn = fn as Deno.TestStepDefinition["fn"] & {
          __anytestName: string;
          __anytestOptions: Omit<Deno.TestDefinition, "name" | "fn">;
        };
        wrappedFn.__anytestName = name;
        wrappedFn.__anytestOptions = options;
      };
      mockTest.only = function (
        this: typeof Deno.test,
        ...args: Parameters<(typeof Deno.test)["only"]>
      ) {
        return this(...args);
      };
      mockTest.ignore = function (
        this: typeof Deno.test,
        ...args: Parameters<typeof Deno.test>
      ) {
        return this(...args);
      };

      return mockTest;
    },

    outro: async () => {
      const process = await import("node:process");
      const payload: TestPayload = JSON.parse(process.env.ANYTEST_PAYLOAD!);
      const test = (globalThis as Global).__anytestRunnerCallbacks.get(
        payload.id,
      );
      if (!test) {
        throw new Error("No test found");
      }

      const testContexts = new Map<string, Deno.TestContext>();

      const testStep = async function (
        this: { nonce: string | undefined },
        ...args: DenoTestArgs
      ) {
        const { name, options, fn } = resolveTestArgs(args);

        const { nonce: newNonce } = await fetch(payload.server, {
          method: "POST",
          body: JSON.stringify({
            type: "stepStart",
            parent: this.nonce,
            ignore: !!options.ignore,
            name,
          }),
        }).then((res) => res.json());
        if (options.ignore) {
          return false;
        }
        const testContext = {
          name,
          origin: payload.file,
          step: testStep.bind({ nonce: newNonce }),
        };
        testContexts.set(newNonce, testContext);
        try {
          await fn(testContext);
          await fetch(payload.server, {
            method: "POST",
            body: JSON.stringify({
              type: "stepPass",
              nonce: newNonce,
            }),
          });
          return true;
        } catch (e) {
          await fetch(payload.server, {
            method: "POST",
            body: JSON.stringify({
              type: "stepFail",
              nonce: newNonce,
              error: String(e),
            }),
          });
          return false;
        }
      };

      try {
        await test({
          name: "test",
          origin: payload.file,
          step: testStep,
        } satisfies Deno.TestContext);
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
    },
  };
};

export type TestPayload = {
  id: number;
  platform: string;
  file: string;
  server: string;
};

export type TestMessage =
  | {
      type: "pass" | "fail";
      error?: string;
    }
  | {
      type: "stepStart";
      parent: string | undefined;
      ignore: boolean;
      name: string;
    }
  | {
      type: "stepPass";
      nonce: string;
    }
  | {
      type: "stepFail";
      nonce: string;
      error: string;
    };
