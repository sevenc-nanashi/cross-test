import type {
  DenoTestArgs,
  SerializedError,
  ToHostMessage,
  ToRunnerMessage,
} from "./base.ts";
import type { InitialParentData } from "./base.ts";

let globalId = 0;

export const crossTestRegistrar = () => {
  return (
    _name: string,
    _options: unknown,
    test: Deno.TestStepDefinition["fn"],
  ) => {
    const localId = globalId++;
    (globalThis as Global).__crosstestRunnerCallbacks.set(localId, test);
  };
};
type Global = typeof globalThis & {
  __crosstestRunnerCallbacks: Map<number, Deno.TestStepDefinition["fn"]>;
};

export const prelude = () => {
  (globalThis as Global).__crosstestRunnerCallbacks = new Map();
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
          __crosstestName: string;
          __crosstestOptions: Omit<Deno.TestDefinition, "name" | "fn">;
        };
        wrappedFn.__crosstestName = name;
        wrappedFn.__crosstestOptions = options;
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

    outro: async (parentData: InitialParentData) => {
      const sendToHost = async (data: ToHostMessage) => {
        return await fetch(parentData.server, {
          method: "POST",
          body: JSON.stringify(data),
        }).then((res) => res.json().catch(() => undefined));
      };

      const debug = parentData.isDebug
        ? (message: string) => {
            console.log(`[crosstest@${parentData.runtime} debug] ${message}`);
          }
        : () => {};

      const testContexts = new Map<string, Deno.TestContext>();

      const testStep = async function (
        this: { nonce: string | undefined; testId: number },
        ...args: DenoTestArgs
      ) {
        const { name, options, fn } = resolveTestArgs(args);

        const { nonce: newNonce } = await sendToHost({
          type: "stepStart",
          name,
          testId: this.testId,
          ignore: !!options.ignore,
          parent: this.nonce,
        });
        if (options.ignore) {
          return false;
        }
        const testContext = {
          name,
          origin: parentData.file,
          parent: this.nonce ? testContexts.get(this.nonce) : undefined,
          step: testStep.bind({ nonce: newNonce, testId: this.testId }),
        };
        testContexts.set(newNonce, testContext);
        try {
          await fn(testContext);
          await sendToHost({
            type: "stepPass",
            testId: this.testId,
            nonce: newNonce,
          });
          return true;
        } catch (e) {
          await sendToHost({
            type: "stepFail",
            testId: this.testId,
            nonce: newNonce,
            error: serializeError(e),
          });
          return false;
        }
      };

      const stdinReader = async function* () {
        const decoder = new TextDecoder();
        const stream = await fetch(parentData.server, {
          method: "GET",
        }).then((res) => res.body!.getReader());
        let buffer = "";
        while (true) {
          const { done, value } = await stream.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            yield line;
          }
        }
      };
      const serializeError = (e: unknown): SerializedError => {
        if (e instanceof Error) {
          return {
            type: "error",
            message: e.message,
            name: e.name,
            stack: e.stack,
          };
        }
        return {
          type: "other",
          value: e,
        };
      };

      await sendToHost({
        type: "ready",
      });

      let shouldExit = false;
      debug("Listening");

      for await (const line of stdinReader()) {
        debug(`Received: ${line}`);
        const data: ToRunnerMessage = JSON.parse(line);
        switch (data.type) {
          case "run":
            try {
              const test = (
                globalThis as Global
              ).__crosstestRunnerCallbacks.get(data.testId);
              if (!test) {
                throw new Error(`Invalid testId: ${data.testId}`);
              }
              await test({
                name: "test",
                origin: parentData.file,
                step: testStep.bind({ testId: data.testId, nonce: undefined }),
              } satisfies Deno.TestContext);
              await sendToHost({
                type: "pass",
                testId: data.testId,
              });
            } catch (e) {
              await sendToHost({
                type: "fail",
                testId: data.testId,
                error: serializeError(e),
              });
            }
            break;
          case "exit":
            shouldExit = true;
            break;
        }
        if (shouldExit) {
          break;
        }
      }
      if (!shouldExit) {
        throw new Error("Unexpected EOF");
      }
    },
  };
};
