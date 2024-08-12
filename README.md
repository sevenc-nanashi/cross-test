# Cross-test / Cross test runner for Deno

Cross-test is a test runner for Deno that allows you to run tests in multiple
JS runtimes.

> [!NOTE]
> This project emulates Cloudflare workers by restricting some functions.
> This does not guarantee that the code will run in Cloudflare workers.

## Installation

```sh
$ deno add @sevenc-nanashi/cross-test
```

## Usage

```ts
import { createCrossTest } from "@sevenc-nanashi/cross-test";

const crossTest = createCrossTest({
  runtimes: ["deno", "node", "bun", "cfWorkers"],
});
```

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.
