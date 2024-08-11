import { TextLineStream } from "@std/streams/text-line-stream";

export class RunnerController {
  process: Deno.ChildProcess;
  ready: Promise<void>;
  callbacks: Record<string, (value: unknown) => void> = {};

  constructor(commands: string[]) {
    this.process = new Deno.Command(commands[0], {
      args: commands.slice(1),
      stdout: "piped",
      stdin: "piped",
    }).spawn();

    const { promise, resolve: resolveReady } = Promise.withResolvers<void>();

    this.ready = promise;

    this.process.status.then((status) => {
      for (const callback of Object.values(this.callbacks)) {
        callback({
          type: "error",
          error: `Process exited with status ${status.code}`,
        });
      }
    });
    this.process.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeTo(
        new WritableStream({
          write: (line) => {
            const message = JSON.parse(line);
            if (message.uuid === "00000000-0000-0000-0000-000000000000") {
              switch (message.payload.type) {
                case "ready": {
                  resolveReady();
                  break;
                }
              }
            } else {
              this.callbacks[message.uuid](message.payload);
            }
          },
        }),
      );
  }

  async send<T>(payload: unknown): Promise<T> {
    const uuid = crypto.randomUUID();
    const payloadString =
      JSON.stringify({
        uuid,
        payload,
      }) + "\r\n";
    const payloadBuffer = new TextEncoder().encode(payloadString);
    const writer = this.process.stdin.getWriter();
    writer.write(payloadBuffer);
    await writer.ready;
    writer.releaseLock();

    return new Promise<T>((resolve) => {
      this.callbacks[uuid] = resolve as (value: unknown) => void;
    });
  }

  async close() {
    await this.send({
      type: "kill",
    });
    await this.process.status;
  }
}
