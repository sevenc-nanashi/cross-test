# Cross-test / Cross test runner for Deno

Cross-test is a test runner for Deno that allows you to run tests in multiple
JS runtimes.

## Supported runtimes

- Deno
- Node.js
- Bun
- Workerd (aka: Cloudflare Workers)
- Browser (coming soon)

## Installation

```sh
$ deno add @sevenc-nanashi/cross-test
```

## Usage

```ts
import { createCrossTest } from "@sevenc-nanashi/cross-test";

const crossTest = createCrossTest({
  runtimes: ["deno", "node", "bun", "workerd"],
});
```

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.
