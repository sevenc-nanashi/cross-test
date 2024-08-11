import { TestOptions } from "./crossTest.ts";

let globalId = 0;

const callbacks = new Map<number, Deno.TestStepDefinition["fn"]>();
export const crossTestRunner = ({
  file,
  options,
}: {
  file: string;
  options: TestOptions;
}) => {
  return (test: Deno.TestStepDefinition["fn"]) => {
    const localId = globalId++;
    callbacks.set(localId, test);

    return () => {
      throw new Error("Unreachable");
    };
  };
};

export const prelude = () => {
  globalThis.Deno = {
    __isAnytestMock: true,
    // @ts-ignore
    test: () => {
      /* noop */
    },
  };
};

export const outro = async () => {
  const readline = await import("node:readline");
  const process = await import("node:process");

  process.stdout.write(
    JSON.stringify({
      uuid: "00000000-0000-0000-0000-000000000000",
      payload: {
        type: "ready",
      },
    }) + "\n",
  );

  let shouldBreak = false;
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const message = JSON.parse(line);
    switch (message.payload.type) {
      case "run": {
        const test = callbacks.get(message.payload.id);
        if (!test) {
          throw new Error("No test found");
        }
        try {
          // @ts-expect-error
          test({});

          process.stdout.write(
            JSON.stringify({
              uuid: message.uuid,
              payload: {
                type: "success",
              },
            }) + "\n",
          );
        } catch (e) {
          process.stdout.write(
            JSON.stringify({
              uuid: message.uuid,
              payload: {
                type: "error",
                error: String(e),
              },
            }) + "\n",
          );
        }
        break;
      }
      case "kill": {
        shouldBreak = true;
        break;
      }
      default: {
        throw new Error(`Unexpected message type: ${message.type}`);
      }
    }
    if (shouldBreak) {
      break;
    }
  }
  if (!shouldBreak) {
    throw new Error("Unexpected end of input");
  }
  rl.close();
};
