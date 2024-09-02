/**
 * @module
 *
 * A proxy to spawn miniflare, as Miniflare is not available in Deno (https://github.com/cloudflare/workers-sdk/issues/6049).
 *
 * This file should be able to run in Node.js.
 */

import { Miniflare } from "miniflare";
import { getPort } from "get-port-please";
import process from "node:process";
import readline from "node:readline";
import type { InitialParentData, SerializedError } from "./base.ts";

const rl = readline.createInterface({
  input: process.stdin,
});

process.chdir(process.env.CROSSTEST_TEMPDIST!);

const mfInstances = new Map<string, Miniflare>();
const handleMfManagerMessage = async (
  message: ToMfManagerMessage,
): Promise<FromMfManagerMessage> => {
  switch (message.type) {
    case "new": {
      const port = await getPort();
      const mf = new Miniflare({
        modules: true,
        compatibilityFlags: [],
        port,
        scriptPath: message.path,
      });
      const id = crypto.randomUUID();
      mfInstances.set(id, mf);

      return { type: "new", id };
    }
    case "start": {
      const mf = mfInstances.get(message.id);
      if (!mf) {
        throw new Error(`Invalid id: ${message.id}`);
      }
      const result = await mf.dispatchFetch(`http://localhost/`, {
        method: "POST",
        body: JSON.stringify(message.initialParentData),
      });
      console.warn(result);
      return { type: "start" };
    }
    case "kill": {
      const mf = mfInstances.get(message.id);
      if (!mf) {
        throw new Error(`Invalid id: ${message.id}`);
      }
      await mf.dispose();
      mfInstances.delete(message.id);

      return { type: "kill" };
    }

    case "exit":
      if (mfInstances.size > 0) {
        for (const mf of mfInstances.values()) {
          await mf.dispose();
        }
      }

      process.exit(0);
      break;
    default:
      throw new Error(
        `Unknown message type: ${(message as { type: string }).type}`,
      );
  }
};

for await (const line of rl) {
  const message: { nonce: string; data: ToMfManagerMessage } = JSON.parse(line);
  try {
    const response = await handleMfManagerMessage(message.data);
    console.log("!" + JSON.stringify({ nonce: message.nonce, ...response }));
  } catch (error) {
    if (error instanceof Error) {
      console.log(
        "!" +
          JSON.stringify(
            {
              nonce: message.nonce,
              type: "error",
              error: {
                type: "error",
                message: error.message,
                name: error.name,
                stack: error.stack,
              },
            } satisfies FromMfManagerMessageError & { nonce: string },
          ),
      );
    } else {
      console.log(
        "!" +
          JSON.stringify({
            nonce: message.nonce,
            type: "error",
            error: {
              type: "other",
              value: error,
            },
          }),
      );
    }
  }
}
throw new Error("Unreachable");

export type ToMfManagerMessage =
  | {
    type: "new";
    path: string;
  }
  | {
    type: "start";
    id: string;
    initialParentData: InitialParentData;
  }
  | {
    type: "kill";
    id: string;
  }
  | {
    type: "exit";
  };

export type FromMfManagerMessage =
  | {
    type: "new";
    id: string;
  }
  | {
    type: "start";
  }
  | {
    type: "kill";
  }
  | {
    type: "exit";
  };

export type FromMfManagerMessageError = {
  type: "error";
  error: SerializedError;
};
