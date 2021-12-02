# GrowthBook Javascript Client Library

Powerful feature flagging and A/B testing for Javascript.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-2.75KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook)

- **No external dependencies**
- **Lightweight and fast**
- Supports both **browsers and nodejs**
- All targeting and assignment happens locally, **no HTTP requests**
- **No flickering** when running A/B tests
- Written in **Typescript** with 100% test coverage
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Remote configuration** to adjust targeting and weights without deploying new code

**Note**: This library is just for bucketing and variation assignment. To manage your experiments/features and analyze the resulting data, use the GrowthBook App (https://github.com/growthbook/growthbook).

## Installation

```
yarn add @growthbook/growthbook
```

or

```
npm install --save @growthbook/growthbook
```

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

// Create a GrowthBook context
const growthbook = new GrowthBook({
  // Optional path to a JSON file with remote configuration data
  configEndpoint: "https://cdn.growthbook.io/config/key_abc123",

  // User attributes for targeting and variation assignment
  attributes: {
    id: "123",
    isPremium: true,
    country: "US",
  },

  // Called when a user is put into an experiment
  trackingCallback: (experiment, result) => {
    analytics.track("Experiment Viewed", {
      experimentId: experiment.trackingKey,
      variationId: result.variationId,
    });
  },
});

// Wait for the `configEndpoint` JSON file to load (optional)
await growthbook.ready();

// Simple boolean on/off flag
if (growthbook.feature("my-feature").on) {
  console.log("Feature enabled!");
}

// Multi-variate or string/JSON values
const color = growthbook.feature("button-color").value || "blue";
```

The return value of `growthbook.feature(key)` is an object with a few properties:

- **value** - the JSON value of the feature
- **source** - why the value was assigned to the user. One of `unknownFeature`, `defaultValue`, `force`, or `experiment`
- **on** and **off** which are simply the JSON value cast to booleans
- **tracked** - true if an experiment was used to determine the value and your trackingCallback was called

## Feature Definitions

Each feature consist of a unique key, a list of possible values, and rules for how to assign values to users. These definitions live in a single JSON object and there are two ways to load this JSON into the context.

You can use the `configEndpoint` setting to automatically fetch the JSON contents from a remote URL and deal with caching. When doing this, you'll need to wait before using features. If you don't wait, no errors will be thrown, you just may get back `null` for all feature checks until the JSON is loaded.

```ts
// Async/await
await growthbook.ready();

// Callback
growthbook.ready(() => {
  // use features here
});
```

If you want to avoid HTTP requests and dealing with asynchronous code, you can pass the JSON directly into the context instead with the `features` setting:

```js
// Same JSON format as the configEndpoint
const jsonValue = {...}
const growthbook = new GrowthBook({
  features: jsonValue,
  ...
})

// No need for await or callbacks
// You can use features immediately
```

If you are using the GrowthBook App to generate the features JSON, you can **stop reading now**. Everything below is for people who want to define the features JSON manually or want to understand what's going on under the hood.

### Basic Feature

An empty feature has two possible values (`false` and `true`) and everyone gets assigned the value `false`.

```js
{
  "my-feature": {}
}
```

You can set your own possible values with the `values` property. You can have as many values as you want and they can be whatever data type you want - booleans, strings, arrays, objects.

```js
// Everyone gets assigned "blue" (array index 0)
{
  "my-feature": {
    values: ["blue", "green", "red"]
  }
}
```

You can change the default assigned value with the `defaultValue` property, which is a pointer to a specific array index in `values`.

```js
// Everyone gets assigned "green" (array index 1)
{
  "my-feature": {
    values: ["blue", "green", "red"],
    defaultValue: 1
  }
}
```

### Feature Rules

You can override the default value with **rules**.

Rules give you fine-grained control over how feature values are assigned to users. There are 2 types of feature rules: `force` and `experiment`.

Each rule can also define targeting conditions that limit which users it applies to. We use the **mongrule** library for defining rules which is really simple and based on MongoDB query syntax.

Here's an example targeting condition that limits a rule to firefox users in the US or Canada:

```js
{
  browser: "firefox",
  country: {
    $in: ["US", "CA"]
  }
}
```

The first rule with matching targeting conditions will be used. That means you can chain rules together to achieve really complex use cases.

#### Force Rules

Force rules do what you'd expect - force everyone to get assigned a specific value. This is only really useful when combined with targeting conditions.

```js
// Paid users get "green" (index 1), everyone else gets "blue" (index 0)
{
  "button-color": {
    values: ["blue", "green"],
    rules: [
      {
        condition: {
          plan: {$ne: "free"} // $ne is "not equals"
        },
        type: "force",
        value: 1
      }
    ],
    defaultValue: 0,
  }
}
```

#### Experiment Rules

Experiment rules let you adjust the percent of users who get randomly assigned to each variation. This can either be used for hypothesis-driven A/B tests or to simply mitigate risk by gradually rolling out new features to your users.

```js
// Each value gets assigned to a random 33.33% of users
{
  "image-size": {
    values: ["small", "medium", "large"],
    rules: [
      {
        type: "experiment"
      }
    ]
  }
}
```

By default, all possible values are included in the experiment in the order they are defined. You can limit an experiment to a subset of values or change the ordering with the `variations` setting:

```js
// The first variation is "large" (2) and will get 50% of users
// The second variation is "small" (0) and will get the other 50%
// The value "medium" is not part of the experiment at all
{
  "image-size": {
    values: ["small", "medium", "large"],
    rules: [
      {
        type: "experiment",
        variations: [2, 0]
      }
    ]
  }
}
```

You can use the `weights` setting to control what percent of users get assigned to each variation. Weights determine the traffic split between variations and must add to 1.

```js
{
  "results-per-page": {
    values: ["small", "medium", "large"],
    rules: [
      {
        type: "experiment",
        // 50% of users will get variation 0 ("small")
        // 30% will get variation 1 ("medium")
        // 20% will get variation 2 ("large")
        weights: [0.5, 0.3, 0.2]
      }
    ]
  }
}
```

When a user is assigned a variation, we call the `trackingCallback` function so you can record the exposure with your analytics event tracking system. By default, we use the feature id to identify the experiment, but this can be overridden if needed with the `trackingKey` setting:

```js
{
  type: "experiment",
  trackingKey: "my-experiment"
}
```

We use deterministic hashing to make sure the same user always gets assigned the same value. By default, we use the attribute `id`, but this can be overridden with the `hashAttribute` setting:

```js
{
  type: "experiment",
  hashAttribute: "device_id"
}
```

You can use the `coverage` setting to introduce sampling and reduce the percent of users who are included in your experiment. Coverage must be between 0 and 1 and defaults to 1 (everyone included). This feature uses deterministic hashing to ensure consistent sampling.

```js
// 80% of users will be included
// 20% will not and will fall through to the next matching rule
{
  type: "experiment",
  coverage: 0.8
}
```

Sometimes you want to run multiple conflicting experiments at the same time. You can use the `namespace` setting to run mutually exclusive experiments. We also use deterministic hashing here to ensure users don't switch experiments.

```js
// Includes users with a hash value for the "pricing" namespace of 0 to 0.6
{
  "feature-1": {
    values: [false, true],
    rules: [
      {
        type: "experiment",
        namespace: ["pricing", 0, 0.6]
      }
    ]
  },
  // Includes users with a hash value for the "pricing" namespace of 0.6 to 1
  "feature-2": {
    values: [false, true],
    rules: [
      {
        type: "experiment",
        namespace: ["pricing", 0.6, 1]
      }
    ]
  }
}
```

### Inline Experiments

Instead of declaring all features up-front in the context and referencing them by ids in your code, you can also just run an experiment directly. This is done with the `growthbook.run` method:

```js
const { value } = growthbook.run({
  trackingKey: "my-experiment",
  variations: ["red", "blue", "green"],
});
```

All of the other settings (`weights`, `hashAttribute`, `coverage`, `namespace`, `condition`) are supported when using inline experiments.

In addition, there are a few other settings that only really make sense for inline experiments:

- `force` can be set to one of the variation array indexes. Everyone will be immediately assigned the specified value.
- `active` can be set to false to disable the experiment and return the control for everyone
- `include` is a callback function that returns a boolean for whether or not someone should be included in the experiment. It's a more flexible alternative to the declarative rules in `condition`

### Remote Overrides for Inline Experiments

The downside with this approach is that you need to deploy new code in order to make a change or stop the experiment. To get the best of both worlds, you can define experiment `overrides` on the context:

```js
const growthbook = new GrowthBook({
  overrides: {
    "my-experiment": {
      status: "stopped",
      force: 1
    }
  },
  ...
})

// The inline experiment says to do a 50/50 split
// Instead, everyone is assigned "b" because of the override
const {value} = growthbook.run({
  trackingKey: "my-experiment",
  variations: ["a", "b"]
})
```

### Experiment Return Value

A call to `growthbook.run(experiment)` returns an object with a few useful properties:

```ts
const {
  inExperiment,
  variationId,
  value,
  hashAttribute,
  hashValue,
} = growthbook.run({
  trackingKey: "my-experiment",
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

## Typescript

This module exposes Typescript type declarations if needed.

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
  trackingKey: "my-test",
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
// Specify a tracking callback when instantiating the context
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
ga("send", "event", "experiment", experiment.trackingKey, result.variationId, {
  // Custom dimension for easier analysis
  dimension1: `${experiment.trackingKey}::${result.variationId}`,
});
```

#### Segment

```ts
analytics.track("Experiment Viewed", {
  experimentId: experiment.trackingKey,
  variationId: result.variationId,
});
```

#### Mixpanel

```ts
mixpanel.track("$experiment_started", {
  "Experiment name": experiment.trackingKey,
  "Variant name": result.variationId,
});
```

### Analysis

Now just connect GrowthBook to the data source where your tracked events end up (Mixpanel, GA, or a data warehouse like Snowflake)
and you can pull the data, run it through the built-in stats engine, and analyze results.

## Dev Mode

If you are using this library to run experiments client-side in a browser, you can use the GrowthBook Dev Mode widget to make development and testing easier.

Simply add the following script tag to your development or staging site:

```html
<script
  async
  src="https://unpkg.com/@growthbook/dev/dist/bundles/index.min.js"
></script>
```

and you should see the Dev Mode widget on the bottom-left of your screen

![Dev Mode Variation Switcher](https://docs.growthbook.io/images/variation-switcher.png)
