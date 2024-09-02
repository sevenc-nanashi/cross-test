# Cross-test / Cross test runner for Deno

Cross-test is a test runner for Deno that allows you to run tests in multiple JS
runtimes.

## Supported runtimes

- Deno
- Node.js
- Bun
- Workerd (aka: Cloudflare Workers)
- Browser

## Installation

```sh
$ deno add @sevenc-nanashi/cross-test
```

## Usage

```ts
import { createCrossTest } from "@sevenc-nanashi/cross-test";

const crossTest = createCrossTest({
  runtimes: ["deno", "node", "bun", "workerd", "browser"],
});

crossTest("My Test", () => {
  // Your test code here will be run in these 5 runtimes.
});
```

## How does it work?

- Deno: It runs the test code in the Deno runtime.
- Node.js, Bun:
  - Compile the test code to ESM using `esbuild`.
  - Run the compiled code in the Node.js or Bun runtime.
- Workerd:
  - Create a Node project which runs miniflare, a local emulator of Cloudflare Workers.
  - Compile the test code to ESM using `esbuild`.
  - Run the compiled code in the Workerd runtime via the created Node project.
- Browser:
  - Compile the test code to ESM using `esbuild`.
  - Run the compiled code in the Browser runtime via [`@astral/astral`](https://jsr.io/@astral/astral)

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file
for details.
