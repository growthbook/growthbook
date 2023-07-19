# Shared Package

This package is used to share Typescript code between the front-end and back-end.

Exports are organized and grouped into separate **Entry Points**. For example:

```ts
import { getValidDate } from "shared/dates";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
```

We don't want too many distinct Entry Points, so try to keep them somewhat generic (e.g. `constants` vs `statsConstants`)

## Adding new exports to an existing Entry Point

Just add a new export in the file in `src` and that's it!

For example, in `src/constants.ts`, I can add:

```ts
export const MY_CONSTANT = 5;
```

Then, anywhere in the front-end or back-end, I can do:

```ts
import { MY_CONSTANT } from "shared/constants";
```

## Adding a new Entry Point

If none of the existing Entry Points meet your needs, you can generate a new one by running the following command:

```sh
yarn plop shared-entrypoint # or `yarn plop` and choosing 'shared-entrypoint'
```

Alternatively, you can manually create a new one with the following steps.

This assumes you are going to make a new `foo` entry point.

1. Create a new file `src/foo.ts` with the things you want to export
   ```ts
   export function bar() {
     return true;
   }
   ```
2. Update `src/index.ts` and add a new line
   ```ts
   export * as foo from "./foo";
   ```
3. Add a new `foo.js` file to the top-level of this package
   ```js
   module.exports = require("./dist/foo.js");
   ```
4. Add a new `foo.d.ts` file to the top-level of this package
   ```js
   export * from "./src/foo";
   ```
5. (Optional) Add tests in `test/foo.test.ts`

   ```js
   import { bar } from "../src/foo";

   describe("bar", () => {
     it("Returns true", () => {
       expect(bar()).toEqual(true);
     });
   });
   ```

Now, you can use your new exports anywhere in the front-end or back-end:

```ts
import { bar } from "shared/foo";

console.log(bar());
```
