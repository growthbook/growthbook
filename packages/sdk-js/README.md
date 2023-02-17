# GrowthBook Javascript SDK

[GrowthBook](https://www.growthbook.io) is an open source Feature Flagging and Experimentation platform.

This is the Javascript client library that lets you evaluate feature flags and run experiments (A/B tests) within a Javascript application.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-4.5KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook)

- **No external dependencies**
- **Lightweight and fast**
- Supports both **modern browsers and Node.js**
- Local targeting and evaluation, **no HTTP requests**
- **No flickering** when running A/B tests
- Written in **Typescript** with 100% test coverage
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Remote configuration** to change feature values without deploying new code

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

### Step 1: Configure your app

```js
import { GrowthBook } from "@growthbook/growthbook";

// Create a GrowthBook instance
const gb = new GrowthBook({
  apiHost: "https://cdn.growthbook.io",
  clientKey: "sdk-abc123",
  // Enable easier debugging of feature flags during development
  enableDevMode: true,
});

// Wait for features to be available
await gb.loadFeatures();
```

#### Node.js Configuration

If using this SDK in a server-side environment, you may need to configure some polyfills for missing browser APIs.

```js
const { setPolyfills } = require("@growthbook/growthbook");

setPolyfills({
  // Required when using built-in feature loading and Node 17 or lower
  fetch: require("cross-fetch"),
  // Required when using encrypted feature flags and Node 18 or lower
  SubtleCrypto: require("node:crypto").webcrypto.subtle,
  // Optional, can make feature rollouts faster
  EventSource: require("eventsource"),
  // Optional, can reduce startup times by persisting cached feature flags
  localStorage: {
    // Example using Redis
    getItem: (key) => redisClient.get(key),
    setItem: (key, value) => redisClient.set(key, value),
  },
});
```

### Step 2: Start Feature Flagging!

There are 2 main methods for evaluating features: `isOn` and `getFeatureValue`:

```js
// Simple boolean (on/off) feature flag
if (gb.isOn("my-feature")) {
  console.log("Feature enabled!");
}

// Get the value of a string/JSON/number feature with a fallback
const color = gb.getFeatureValue("button-color", "blue");
```

## Loading Features

In order for the GrowthBook SDK to work, it needs to have feature definitions from the GrowthBook API. There are 2 ways to get this data into the SDK.

### Built-in Fetching and Caching

If you pass an `apiHost` and `clientKey` into the GrowthBook constructor, it will handle the network requests, caching, retry logic, etc. for you automatically. If your feature payload is encrypted, you can also pass in a `decryptionKey`.

```ts
const gb = new GrowthBook({
  apiHost: "https://cdn.growthbook.io",
  clientKey: "sdk-abc123",
  decryptionKey: "key_abc123", // Only if you have feature encryption turned on
});

// Wait for features to be downloaded
await gb.loadFeatures({
  // When features change, update the GrowthBook instance automatically
  // Default: `false`
  autoRefresh: true,
  // If the network request takes longer than this (in milliseconds), continue
  // Default: `0` (no timeout)
  timeout: 2000,
});
```

Until features are loaded, all features will evaluate to `null`. If you're ok with a potential flicker in your application (features going from `null` to their real value), you can call `loadFeatures` without awaiting the result.

If you want to refresh the features at any time (e.g. when a navigation event occurs), you can call `gb.refreshFeatures()`.

### Custom Integration

If you prefer to handle the network and caching logic yourself, you can instead pass in a features JSON object directly. For example, you might store features in Postgres and send it down to your front-end as part of your app's initial bootstrap API call.

```ts
const gb = new GrowthBook({
  features: {
    "feature-1": {...},
    "feature-2": {...},
    "another-feature": {...},
  }
})
```

Note that you don't have to call `gb.loadFeatures()`. There's nothing to load - everything required is already passed in.

You can update features at any time by calling `gb.setFeatures()` with a new JSON object.

### Re-rendering When Features Change

When features change (e.g. by calling `gb.refreshFeatures()`), you need to re-render your app so that all of your feature flag checks can be re-evaluated. You can specify your own custom rendering function for this purpose:

```js
// Callback to re-render your app when feature flag values change
gb.setRenderer(() => {
  // TODO: re-render your app
});
```

## Experimentation (A/B Testing)

In order to run A/B tests on your feature flags, you need to set up a tracking callback function. This is called every time a user is put into an experiment and can be used to track the exposure event in your analytics system (Segment, Mixpanel, GA, etc.).

```js
const gb = new GrowthBook({
  apiHost: "https://cdn.growthbook.io",
  clientKey: "sdk-abc123",
  trackingCallback: (experiment, result) => {
    // Example using Segment
    analytics.track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.variationId,
    });
  },
});
```

If the experiment came from a feature rule, `result.featureId` will contain the feature id, which may be useful for tracking/logging purposes.

Once you define the callback, just use feature flags like normal in your code. If an experiment is used to determine the feature flag value, it will automatically call your tracking callback.

```js
// If this has an active experiment, it will call trackingCallback automatically
const newLogin = gb.isOn("new-signup-form");
```

## Typescript

When using `getFeatureValue`, the type of the feature is inferred from the fallback value you provide.

```ts
// color will be type "string"
const color = gb.getFeatureValue("button-color", "blue");
```

When using `evalFeature`, the value has type `any` by default, but you can specify a more restrictive type using generics. Note that whatever type you specify will be unioned with `null` in the return value.

```ts
// result.value will be type "number | null" now
const result = gb.evalFeature<number>("button-size");
```

When using inline experiments, the returned value is inferred from the variations you pass in:

```ts
// result.value will be type "string"
const result = gb.run({
  key: "my-test",
  variations: ["blue", "green"],
});
```

There are a number of types you can import as well if needed:

```ts
import type {
  Context,
  Attributes,
  Polyfills,
  CacheSettings,
  FeatureApiResponse,
  LoadFeaturesOptions,
  RefreshFeaturesOptions,
  FeatureDefinitions,
  FeatureDefinition,
  FeatureRule,
  FeatureResult,
  FeatureResultSource,
  Experiment,
  Result,
  ExperimentOverride,
  ExperimentStatus,
  JSONValue,
  SubscriptionFunction,
  LocalStorageCompat,
} from "@growthbook/growthbook";
```

## GrowthBook Instance (reference)

### Attributes

You can specify attributes about the current user and request. These are used for two things:

1.  Feature targeting (e.g. paid users get one value, free users get another)
2.  Assigning persistent variations in A/B tests (e.g. user id "123" always gets variation B)

The following are some comonly used attributes, but use whatever makes sense for your application.

```ts
new GrowthBook({
  attributes: {
    id: "123",
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

### Feature Usage Callback

GrowthBook can fire a callback whenever a feature is evaluated for a user. This can be useful to update 3rd party tools like NewRelic or DataDog.

```ts
new GrowthBook({
  onFeatureUsage: (featureKey, result) => {
    console.log("feature", featureKey, "has value", result.value);
  },
});
```

The `result` argument is the same thing returned from `gb.evalFeature`.

Note: If you evaluate the same feature multiple times (and the value doesn't change), the callback will only be fired the first time.

### Dev Mode

There is a [GrowthBook Chrome DevTools Extension](https://chrome.google.com/webstore/detail/growthbook-devtools/opemhndcehfgipokneipaafbglcecjia) that can help you debug and test your feature flags in development.

In order for this to work, you must explicitly enable dev mode when creating your GrowthBook instance:

```js
const gb = new GrowthBook({
  enableDevMode: true,
});
```

To avoid exposing all of your internal feature flags and experiments to users, we recommend setting this to `false` in production in most cases.

### evalFeature

In addition to the `isOn` and `getFeatureValue` helper methods, there is the `evalFeature` method that gives you more detailed information about why the value was assigned to the user.

```ts
// Get detailed information about the feature evaluation
const result = gb.evalFeature("my-feature");

// The value of the feature (or `null` if not defined)
console.log(result.value);

// Why the value was assigned to the user
// One of: `override`, `unknownFeature`, `defaultValue`, `force`, or `experiment`
console.log(result.source);

// The string id of the rule (if any) which was used
console.log(result.ruleId);

// Information about the experiment (if any) which was used
console.log(result.experiment);

// The result of the experiment (or `undefined`)
console.log(result.experimentResult);
```

### Inline Experiments

Instead of declaring all features up-front in the context and referencing them by ids in your code, you can also just run an experiment directly. This is done with the `gb.run` method:

```js
const { value } = gb.run({
  key: "my-experiment",
  variations: ["red", "blue", "green"],
});
```

All of the other settings (`weights`, `hashAttribute`, `coverage`, `namespace`, `condition`) are supported when using inline experiments.

In addition, there are a few other settings that only really make sense for inline experiments:

- `force` can be set to one of the variation array indexes. Everyone will be immediately assigned the specified value.
- `active` can be set to false to disable the experiment and return the control for everyone

#### Inline Experiment Return Value

A call to `gb.run(experiment)` returns an object with a few useful properties:

```ts
const {
  inExperiment,
  hashUsed,
  variationId,
  value,
  hashAttribute,
  hashValue,
} = gb.run({
  key: "my-experiment",
  variations: ["A", "B"],
});

// If user is included in the experiment
console.log(inExperiment); // true or false

// The index of the assigned variation
console.log(variationId); // 0 or 1

// The value of the assigned variation
console.log(value); // "A" or "B"

// If the variation was randomly assigned by hashing
console.log(hashUsed);

// The user attribute that was hashed
console.log(hashAttribute); // "id"

// The value of that attribute
console.log(hashValue); // e.g. "123"
```

The `inExperiment` flag will be false if the user was excluded from being part of the experiment for any reason (e.g. failed targeting conditions).

The `hashUsed` flag will only be true if the user was randomly assigned a variation. If the user was forced into a specific variation instead, this flag will be false.

## Feature Definitions (reference)

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

#### Rule Ids

Rules can specify a unique identifier with the `id` property. This can help with debugging and QA by letting you see exactly why a specific value was assigned to a user.

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
        id: "rule-123",
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
const gb = new GrowthBook({
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
