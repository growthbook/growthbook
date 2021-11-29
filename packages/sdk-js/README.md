# GrowthBook Javascript Client Library

Powerful A/B testing for Javascript.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-1.66KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook)

- **No external dependencies**
- **Lightweight and fast**
- **No HTTP requests** everything is defined and evaluated locally
- Supports both **browsers and nodejs**
- **No flickering or blocking calls**
- Written in **Typescript** with 100% test coverage
- Flexible experiment **targeting**
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Adjust variation weights and targeting** without deploying new code

**Note**: This library is just for running A/B tests in Javascript. To analyze results, use the GrowthBook App (https://github.com/growthbook/growthbook).

## Installation

`yarn add @growthbook/growthbook`

or

`npm install --save @growthbook/growthbook`

or use directly in your HTML without installing first:

```html
<script type="module">
  import { GrowthBook } from "https://unpkg.com/@growthbook/growthbook/dist/bundles/esm.min.js";
  //...
</script>
```

## Quick Usage

```ts
import { GrowthBook } from "@growthbook/growthbook";

// Define the experimental context
const growthbook = new GrowthBook({
  // The attributes used to assign variations
  user: { id: "123" },
  // Called when a user is put into an experiment
  trackingCallback: (experiment, result) => {
    analytics.track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.variationId,
    });
  },
});

// Run an experiment
const { value } = growthbook.run({
  key: "my-experiment",
  variations: ["A", "B"],
});

console.log(value); // "A" or "B"
```

## Documentation

See the full documentation and more usage examples at https://docs.growthbook.io/lib/js
