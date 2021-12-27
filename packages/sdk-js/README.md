# GrowthBook Javascript SDK

[GrowthBook](https://www.growthbook.io) is a modular Feature Flagging and Experimentation platform.

This is the Javascript client library that lets you evaluate feature flags and run experiments (A/B tests) within a Javascript application.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-2.65KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook)

- **No external dependencies**
- **Lightweight and fast**
- Supports both **browsers and nodejs**
- Local targeting and evaluation, **no HTTP requests**
- **No flickering** when running A/B tests
- Written in **Typescript** with 100% test coverage
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Remote configuration** to adjust targeting and weights without deploying new code

## Installation

```
yarn add @growthbook/growthbook
```

or

```
npm i --save @growthbook/growthbook
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
const growthbook = new GrowthBook();

// Load feature definitions (from API, database, etc.)
await fetch("https://s3.amazonaws.com/myBucket/features.json")
  .then((res) => res.json())
  .then((parsed) => {
    growthbook.setFeatures(parsed);
  });

// Simple on/off feature flag
if (growthbook.feature("my-feature").on) {
  console.log("Feature enabled!");
}

// Feature with multiple possible values
const color = growthbook.feature("button-color").value || "blue";
```

## The GrowthBook Context

The `GrowthBook` constructor takes a number of optional settings.

### Features

If you already have features loaded as a JSON object, you can pass them into the constructor with the `features` field:

```ts
new GrowthBook({
  features: {
    "feature-1": {...},
    "feature-2": {...},
    "another-feature": {...},
  }
})
```

If you need to load feature definitions from a remote source like an API or database, you can update the context at any time with `setFeatures()` (seen above in the Quick Start). **Note** - if you try to use a feature before it is loaded, it will always evaluate to `null`.

If you use the GrowthBook App to manage your features, you don't need to build this JSON file yourself - it will auto-generate one for you and make it available via an API endpoint.

If you prefer to build this file by hand or you want to know how it works under the hood, check out the detailed [Feature Definitions](#feature-definitions) section below.

### Attributes

You can specify attributes about the current user and request. These are used for two things:

1.  Feature targeting (e.g. paid users get one value, free users get another)
2.  Assigning persistent variations in A/B tests (e.g. user id "123" always gets variation B)

The following are some comonly used attributes, but use whatever makes sense for your application.

```ts
new GrowthBook({
  attributes: {
    id: "123",
    environment: "prod",
    loggedIn: true,
    deviceId: "abc123def456",
    company: "acme",
    paid: false,
    url: "/pricing",
    browser: "chrome",
    mobile: false,
    country: "US",
  },
});
```

If you need to set or update attributes asynchronously, you can do so with `setAttributes()`. This will completely overwrite the attributes object with whatever you pass in. Also, be aware that changing attributes may change the assigned feature values. This can be disorienting to users if not handled carefully.

### Tracking Callback

Any time an experiment is run to determine the value of a feature, we call a function so you can record the assigned value in your event tracking or analytics system of choice.

```ts
new GrowthBook({
  trackingCallback: (experiment, result) => {
    // Example using Segment.io
    analytics.track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.variationId,
    });
  },
});
```

## Using Features

The main method, `growthbook.feature(key)` takes a feature key and returns an object with a few properties:

- **value** - The JSON value of the feature (or `null` if not defined)
- **on** and **off** - The JSON value cast to booleans (to make your code easier to read)
- **source** - Why the value was assigned to the user. One of `unknownFeature`, `defaultValue`, `force`, or `experiment`
- **experiment** - Information about the experiment (if any) which was used to assign the value to the user

Here's an example that uses all of them:

```ts
const result = growthbook.feature("my-feature");

// The JSON value (might be null, string, boolean, number, array, or object)
console.log(result.value);

if (result.on) {
  // Feature value is truthy
}
if (result.off) {
  // Feature value is falsy
}

// If the feature value was assigned as part of an experiment
if (result.source === "experiment") {
  // Get all the possible variations that could have been assigned
  console.log(experiment.variations);
}
```

## Feature Definitions

The feature definition JSON file contains information about all of the features in your application.

Each feature consists of a unique key, a list of possible values, and rules for how to assign those values to users.

```ts
{
  "feature-1": {...},
  "feature-2": {...},
  "another-feature": {...},
}
```

### Basic Feature

An empty feature always has the value `null`:

```js
{
  "my-feature": {}
}
```

#### Default Values

You can change the default assigned value with the `defaultValue` property:

```js
{
  "my-feature": {
    defaultValue: "green"
  }
}
```

### Override Rules

You can override the default value with **rules**.

Rules give you fine-grained control over how feature values are assigned to users. There are 2 types of feature rules: `force` and `experiment`. Force rules give the same value to everyone. Experiment rules assign values to users randomly.

#### Rule Conditions

Rules can optionally define targeting conditions that limit which users the rule applies to. These conditions are evaluated against the `attributes` passed into the GrowthBook context. The syntax for conditions is based on the MongoDB query syntax and is straightforward to read and write.

For example, if the attributes are:

```json
{
  "id": "123",
  "browser": {
    "vendor": "firefox",
    "version": 94
  },
  "country": "CA"
}
```

The following condition would evaluate to `true`:

```json
{
  "browser.vendor": "firefox",
  "country": {
    "$in": ["US", "CA", "IN"]
  }
}
```

If a condition evaluates to `false`, the rule will be skipped. This means you can chain rules together with different conditions to support even the most complex use cases.

#### Force Rules

Force rules do what you'd expect - force a specific value for the feature

```js
// Firefox users in the US or Canada get "green"
// Everyone else gets the default "blue"
{
  "button-color": {
    defaultValue: "blue",
    rules: [
      {
        condition: {
          browser: "firefox",
          country: {
            $in: ["US", "CA"]
          }
        },
        force: "green"
      }
    ],
  }
}
```

##### Gradual Rollouts

You can specify a `coverage` value for your rule, which is a number between 0 and 1 and represents what percent of users will get the rule applied to them. Users who do not get the rule applied will fall through to the next matching rule (or default value).

This is useful for gradually rolling out features to users (start coverage at 0 and slowly increase towards 1 as you watch metrics).

```js
// 20% of users will get the new feature
{
  "new-feature": {
    defaultValue: false,
    rules: [
      {
        force: true,
        coverage: 0.2
      }
    ]
  }
}
```

In order to figure out if a user is included or not, we use deterministic hashing. By default, we use the user attribute `id` for this, but you can override this by specifying `hashAttribute` for the rule:

```js
// 20% of companies will get the new feature
// Users in the same company will always get the same value (either true or false)
{
  "new-feature": {
    defaultValue: false,
    rules: [
      {
        force: true,
        coverage: 0.2,
        hashAttribute: "company"
      }
    ]
  }
}
```

#### Experiment Rules

Experiment rules let you adjust the percent of users who get randomly assigned to each variation. This can either be used for hypothesis-driven A/B tests or to simply mitigate risk by gradually rolling out new features to your users.

```js
// Each variation gets assigned to a random 1/3rd of users
{
  "image-size": {
    rules: [
      {
        variations: ["small", "medium", "large"]
      }
    ]
  }
}
```

##### Weights

You can use the `weights` setting to control what percent of users get assigned to each variation. Weights determine the traffic split between variations and must add to 1.

```js
{
  "results-per-page": {
    rules: [
      {
        variations: ["small", "medium", "large"],
        // 50% of users will get "small" (index 0)
        // 30% will get "medium" (index 1)
        // 20% will get "large" (index 2)
        weights: [0.5, 0.3, 0.2]
      }
    ]
  }
}
```

##### Tracking Key

When a user is assigned a variation, we call the `trackingCallback` function so you can record the exposure with your analytics event tracking system. By default, we use the feature id to identify the experiment, but this can be overridden if needed with the `key` setting:

```js
{
  "feature-1": {
    rules: [
      {
        // Use "my-experiment" as the key instead of "feature-1"
        key: "my-experiment",
        variations: ["A", "B"]
      }
    ]
  },
}
```

##### Hash Attribute

We use deterministic hashing to make sure the same user always gets assigned the same value. By default, we use the attribute `id`, but this can be overridden with the `hashAttribute` setting:

```js
const growthbook = new GrowthBook({
  attributes: {
    id: "123",
    company: "acme",
  },
  features: {
    "my-feature": {
      rules: [
        // All users with the same "company" value
        // will be assigned the same variation
        {
          variations: ["A", "B"],
          hashAttribute: "company",
        },
        // If "company" is empty for the user (e.g. if they are logged out)
        // The experiment will be skipped and fall through to this next rule
        {
          force: "A",
        },
      ],
    },
  },
});
```

##### Coverage

You can use the `coverage` setting to introduce sampling and reduce the percent of users who are included in your experiment. Coverage must be between 0 and 1 and defaults to 1 (everyone included). This feature uses deterministic hashing to ensure consistent sampling.

```js
{
  "my-feature": {
    rules: [
      // 80% of users will be included in the experiment
      {
        variations: [false, true],
        coverage: 0.8
      },
      // The remaining 20% will fall through to this next matching rule
      {
        force: false
      }
    ]
  }
}
```

##### Namespaces

Sometimes you want to run multiple conflicting experiments at the same time. You can use the `namespace` setting to run mutually exclusive experiments.

We do this using deterministic hashing to assign users a value between 0 and 1 for each namespace. Experiments can specify which namespace it is in and what part of the range [0,1] it should include. If the ranges for two experiments in a namespace don't overlap, they will be mutually exclusive.

```js
{
  "feature1": {
    rules: [
      // Will include 60% of users - ones with a hash between 0 and 0.6
      {
        variations: [false, true],
        namespace: ["pricing", 0, 0.6]
      }
    ]
  },
  "feature2": {
    rules: [
      // Will include the other 40% of users - ones with a hash between 0.6 and 1
      {
        variations: [false, true],
        namespace: ["pricing", 0.6, 1]
      },
    ]
  }
}
```

**Note** - If a user is excluded from an experiment due to the namespace range, the rule will be skipped and the next matching rule will be used instead.

## Inline Experiments

Instead of declaring all features up-front in the context and referencing them by ids in your code, you can also just run an experiment directly. This is done with the `growthbook.run` method:

```js
const { value } = growthbook.run({
  key: "my-experiment",
  variations: ["red", "blue", "green"],
});
```

All of the other settings (`weights`, `hashAttribute`, `coverage`, `namespace`, `condition`) are supported when using inline experiments.

In addition, there are a few other settings that only really make sense for inline experiments:

- `force` can be set to one of the variation array indexes. Everyone will be immediately assigned the specified value.
- `active` can be set to false to disable the experiment and return the control for everyone
- `include` is a callback function that returns a boolean for whether or not someone should be included in the experiment. It's a more flexible alternative to the declarative rules in `condition`

### Overrides for Inline Experiments

With Inline Experiments, you typically need to deploy new code anytime you want to make a change. For example, if an experiment wins and you want to roll it out to 100% of users.

As a short-term alternative, you can pass `experimentOverrides` into the context. If you pull these overrides from a database or API, you can effectively control experiments remotely in realtime without deploying new code.

```js
const growthbook = new GrowthBook({
  experimentOverrides: {
    "my-experiment": {
      force: 1
    }
  },
  ...
})

// The inline experiment says to do a 50/50 split
// Instead, everyone will be assigned "b" because of the override
const {value} = growthbook.run({
  key: "my-experiment",
  variations: ["a", "b"]
})
```

### Inline Experiment Return Value

A call to `growthbook.run(experiment)` returns an object with a few useful properties:

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

## Typescript

Feature values are `any` by default, but you can specify a more restrictive type if you want:

```ts
// color will be type `string|null`
const color = growthbook.feature<string>("button-color").value;
```

There are a number of types you can import as well if needed:

```ts
import type {
  Context,
  ConditionInterface,
  Experiment,
  ExperimentOverride,
  FeatureDefinition,
  FeatureResult,
  ExperimentResult,
} from "@growthbook/growthbook";
```

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
