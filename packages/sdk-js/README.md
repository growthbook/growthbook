# Growth Book Javascript SDK

Powerful A/B testing for Javascript.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-1.65KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook)

- **No external dependencies**
- **Lightweight and fast**
- **No HTTP requests** everything is defined and evaluated locally
- Supports both **browsers and nodejs**
- **No flickering or blocking calls**
- Written in **Typescript** with 100% test coverage
- Flexible experiment **targeting**
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- **Adjust variation weights and targeting** without deploying new code

**Note**: This library is just for running A/B tests in Javascript. To analyze results, use the Growth Book App (https://github.com/growthbook/growthbook).

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

## GrowthBook class

The GrowthBook constructor takes a `Context` object. Below are all of the possible Context properties:

- **enabled** (`boolean`) - Switch to globally disable all experiments. Default true.
- **user** (`{}`) - Map of user attributes that are used to assign variations
- **groups** (`{}`) - A map of which groups the user belongs to (key is the group name, value is boolean)
- **url** (`string`) - The URL of the current page (defaults to `window.location.href` when in a browser environment)
- **overrides** (`{}`) - Override properties of specific experiments (used for Remote Config)
- **forcedVariations** (`{}`) - Force specific experiments to always assign a specific variation (used for QA)
- **qaMode** (`boolean`) - If true, random assignment is disabled and only explicitly forced variations are used.
- **trackingCallback** (`function`) - A function that takes `experiment` and `result` as arguments.

## Experiments

Below are all of the possible properties you can set for an Experiment:

- **key** (`string`) - The globally unique tracking key for the experiment
- **variations** (`any[]`) - The different variations to choose between
- **weights** (`number[]`) - How to weight traffic between variations. Must add to 1.
- **status** (`string`) - "running" is the default and always active. "draft" is only active during QA and development. "stopped" is only active when forcing a winning variation to 100% of users.
- **coverage** (`number`) - What percent of users should be included in the experiment (between 0 and 1, inclusive)
- **url** (`RegExp`) - Users can only be included in this experiment if the current URL matches this regex
- **include** (`() => boolean`) - A callback that returns true if the user should be part of the experiment and false if they should not be
- **groups** (`string[]`) - Limits the experiment to specific user groups
- **force** (`number`) - All users included in the experiment will be forced into the specific variation index
- **hashAttribute** (`string`) - What user attribute should be used to assign variations (defaults to "id")

## Running Experiments

Run experiments by calling `growthbook.run(experiment)` which returns an object with a few useful properties:

```ts
const {
  inExperiment,
  variationId,
  value,
  hashAttribute,
  hashValue,
} = growthbook.run({
  key: "my-experiment",
  variations: ["A", "B"],
});

// If user is part of the experiment
console.log(inExperiment); // true or false

// The index of the assigned variation
console.log(variationId); // 0 or 1

// The value of the assigned variation
console.log(value); // "A" or "B"

// The user attribute used to assign a variation
console.log(hashAttribute); // "id"

// The value of that attribute
console.log(hashValue); // e.g. "123"
```

The `inExperiment` flag is only set to true if the user was randomly assigned a variation. If the user failed any targeting rules or was forced into a specific variation, this flag will be false.

### Example Experiments

3-way experiment with uneven variation weights:

```ts
growthbook.run({
  key: "3-way-uneven",
  variations: ["A", "B", "C"],
  weights: [0.5, 0.25, 0.25],
});
```

Slow rollout (10% of users who opted into "beta" features):

```ts
// User is in the "qa" and "beta" groups
const growthbook = new GrowthBook({
  user: { id: "123" },
  groups: {
    qa: isQATester(),
    beta: betaFeaturesEnabled(),
  },
});

growthbook.run({
  key: "slow-rollout",
  variations: ["A", "B"],
  coverage: 0.1,
  groups: ["beta"],
});
```

Complex variations and custom targeting

```ts
const {value} = growthbook.run({
  key: "complex-variations",
  variations: [
    {color: "blue", size: "large"},
    {color: "green", size: "small"}
  ],
  url: /^\/post\/[0-9]+$/i
  include: () => isPremium || creditsRemaining > 50
});

console.log(value.color, value.size); // blue,large OR green,small
```

Assign variations based on something other than user id

```ts
const growthbook = new GrowthBook({
  user: {
    id: "123",
    company: "growthbook",
  },
});

growthbook.run({
  key: "by-company-id",
  variations: ["A", "B"],
  hashAttribute: "company",
});

// Users in the same company will always get the same variation
```

### Overriding Experiment Configuration

It's common practice to adjust experiment settings after a test is live. For example, slowly ramping up traffic, stopping a test automatically if guardrail metrics go down, or rolling out a winning variation to 100% of users.

For example, to roll out a winning variation to 100% of users:

```ts
const growthbook = new GrowthBook({
  user: { id: "123" },
  overrides: {
    "experiment-key": {
      status: "stopped",
      force: 1,
    },
  },
});

const { value } = growthbook.run({
  key: "experiment-key",
  variations: ["A", "B"],
});

console.log(value); // Always "B"
```

The full list of experiment properties you can override is:

- status
- force
- weights
- coverage
- groups
- url (can use string instead of regex if serializing in a database)

If you use the Growth Book App (https://github.com/growthbook/growthbook) to manage experiments, there's a built-in API endpoint you can hit that returns overrides in this exact format. It's a great way to make sure your experiments are always up-to-date.

## Typescript

This module exposes Typescript types if needed.

This is especially useful if experiments are defined as a variable before being passed into `growthbook.run`. Unions and tuples are used heavily and Typescript has trouble inferring those properly.

```ts
import type {
  Context,
  Experiment,
  Result,
  ExperimentOverride,
} from "@growthbook/growthbook";

// The "number" part refers to the variation type
const exp: Experiment<number> = {
  key: "my-test",
  variations: [0, 1],
  status: "stoped", // Type error! (should be "stopped")
};
```

## Event Tracking and Analyzing Results

This library only handles assigning variations to users. The 2 other parts required for an A/B testing platform are Tracking and Analysis.

### Tracking

It's likely you already have some event tracking on your site with the metrics you want to optimize (Google Analytics, Segment, Mixpanel, etc.).

For A/B tests, you just need to track one additional event - when someone views a variation.

```ts
// Specify a tracking callback when instantiating the client
const growthbook = new GrowthBook({
  user: { id: "123" },
  trackingCallback: (experiment, result) => {
    // ...
  },
});
```

Below are examples for a few popular event tracking tools:

#### Google Analytics

```ts
ga("send", "event", "experiment", experiment.key, result.variationId, {
  // Custom dimension for easier analysis
  dimension1: `${experiment.key}::${result.variationId}`,
});
```

#### Segment

```ts
analytics.track("Experiment Viewed", {
  experimentId: experiment.key,
  variationId: result.variationId,
});
```

#### Mixpanel

```ts
mixpanel.track("$experiment_started", {
  "Experiment name": experiment.key,
  "Variant name": result.variationId,
});
```

### Analysis

For analysis, there are a few options:

- Online A/B testing calculators
- Built-in A/B test analysis in Mixpanel/Amplitude
- Python or R libraries and a Jupyter Notebook
- The Growth Book App (https://github.com/growthbook/growthbook)

### The Growth Book App

Managing experiments and analyzing results at scale can be complicated, which is why we built the [Growth Book App](https://github.com/growthbook/growthbook).

- Query multiple data sources (Snowflake, Redshift, BigQuery, Mixpanel, Postgres, Athena, and Google Analytics)
- Bayesian statistics engine with support for binomial, count, duration, and revenue metrics
- Drill down into A/B test results (e.g. by browser, country, etc.)
- Lightweight idea board and prioritization framework
- Document everything! (upload screenshots, add markdown comments, and more)
- Automated email alerts when tests become significant

Integration is super easy:

1.  Create a Growth Book API key
2.  Periodically fetch the latest experiment overrides from the API and cache in Redis, Mongo, etc.
3.  At the start of your app, pass in the overrides to the GrowthBook constructor

Now you can start/stop tests, adjust coverage and variation weights, and apply a winning variation to 100% of traffic, all within the Growth Book App without deploying code changes to your site.
