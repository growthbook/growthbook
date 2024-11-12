# GrowthBook Svelte SDK

[GrowthBook](https://www.growthbook.io) is a modular Feature Flagging and Experimentation platform.

This is the Svelte client library that lets you evaluate feature flags and run experiments (A/B tests) within a Svelte application. It is a thin wrapper around the [Javascript SDK](https://docs.growthbook.io/lib/js), so you might want to view those docs first to familiarize yourself with the basic classes and methods.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-3.1KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook-svelte)

- **No external dependencies**
- **Lightweight and fast**
- Local targeting and evaluation, **no HTTP requests**
- Works for both **client and server-side** rendering
- **No flickering** when running A/B tests
- Written in **Typescript** with extensive test coverage
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Remote configuration** to change feature values without deploying new code
- Run **Visual Experiments** without writing code by using the GrowthBook Visual Editor

## Community

Join [our GrowthBook Users Slack community](https://slack.growthbook.io) if you need help, want to chat, or are thinking of a new feature. We're here to help - and to make GrowthBook even better.

## Installation

```
yarn add @growthbook/growthbook-svelte
```

or

```
npm install --save @growthbook/growthbook-svelte
```

## Quick Usage

### Step 1: Configure your app

```sveltehtml

<script lang="ts">
  import { GrowthBook } from "@growthbook/growthbook";
  import { GrowthBookProvider } from "@growthbook/growthbook-svelte";

  // Create a GrowthBook instance
  const gb = new GrowthBook({
    apiHost: "https://cdn.growthbook.io",
    clientKey: "sdk-abc123",
    // Enable easier debugging during development
    // Only required for A/B testing
    // Called every time a user is put into an experiment
    trackingCallback: (experiment, result) => {
      console.log("Experiment Viewed", {
        experimentId: experiment.key,
        variationId: result.key,
      });
    },
  });

  // Load features from the GrowthBook API
  gb.loadFeatures();

  // Set user attributes for targeting (from cookie, auth system, etc.)
  gb.setAttributes({
    id: user.id,
    company: user.company,
  });
</script>

<GrowthBookProvider>
  <OtherComponent />
</GrowthBookProvider>
```

### Step 2: Start feature flagging!

There are a few ways to use feature flags in GrowthBook:

#### Feature Hooks

```sveltehtml
<script lang="ts">
  import { useFeatureValue, useFeatureIsOn } from "@growthbook/growthbook-svelte";

  // Boolean on/off features
  const newLogin = useFeatureIsOn("new-login-form");

  // String/Number/JSON features with a fallback value
  const buttonColor = useFeatureValue("login-button-color", "blue");
</script>

{#if newLogin}
  <NewLogin color={buttonColor} />
{:else}
  <Login color={buttonColor} />
{/if}
```

#### Feature Wrapper Components

```sveltehtml
<script lang="ts">
  import { IfFeatureEnabled, FeatureString } from "@growthbook/growthbook-svelte";
</script>

<h1>
  <FeatureString feature="site-h1" default="My Site" />
</h1>
<IfFeatureEnabled feature="welcome-message">
  <p>Welcome to our site!</p>
</IfFeatureEnabled>
```

#### useGrowthBook hook

If you need low-level access to the GrowthBook instance for any reason, you can use the `useGrowthBook` hook.

One example is updating targeting attributes when a user logs in:

```ts
import { useGrowthBook } from "@growthbook/growthbook-svelte";

export default function auth() {
  const growthbook = useGrowthBook();

  const user = useUser();
  if (!user || !growthbook) return;
  growthbook.setAttributes({
    loggedIn: true,
    id: user.id,
    company: user.company,
    isPro: user.plan === "pro"
  });

  ...
}
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

### Waiting for Features to Load

There is a helper component `<FeaturesReady>` that lets you render a fallback component until features are done loading. This works for both built-in fetching and custom integrations.

```sveltehtml
<FeaturesReady timeout={500}>
  <ComponentThatUsesFeatures slot="primary" />
  <LoadingSpinner slot="fallback" />
</FeaturesReady>
```

- `timeout` is the max time you want to wait for features to load (in ms). The default is `0` (no timeout).
- `fallback` is the component you want to display before features are loaded. The default is `null`.

If you want more control, you can use the `useGrowthBook()` hook and the `ready` flag:

```ts
const gb = useGrowthBook();

if (gb.ready) {
  // Do something
}
```

## Experimentation (A/B Testing)

In order to run A/B tests, you need to set up a tracking callback function. This is called every time a user is put into an experiment and can be used to track the exposure event in your analytics system (Segment, Mixpanel, GA, etc.).

```js
const gb = new GrowthBook({
  apiHost: "https://cdn.growthbook.io",
  clientKey: "sdk-abc123",
  trackingCallback: (experiment, result) => {
    // Example using Segment
    analytics.track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.key,
    });
  },
});
```

This same tracking callback is used for both feature flag experiments and Visual Editor experiments.

### Feature Flag Experiments

There is nothing special you have to do for feature flag experiments. Just evaluate the feature flag like you would normally do. If the user is put into an experiment as part of the feature flag, it will call the `trackingCallback` automatically in the background.

```js
// If this has an active experiment and the user is included,
// it will call trackingCallback automatically
useFeatureIsOn("new-signup-form");
```

If the experiment came from a feature rule, `result.featureId` in the trackingCallback will contain the feature id, which may be useful for tracking/logging purposes.

### Visual Editor Experiments

Experiments created through the GrowthBook Visual Editor will run automatically as soon as their targeting conditions are met.

**Note**: Visual Editor experiments are only supported in a web browser environment. They will not run during Server Side Rendering (SSR).

If you are using this SDK in a Single Page App (SPA), you will need to let the GrowthBook instance know when the URL changes so the active experiments can update accordingly.

## API Reference

There are a number of configuration options and settings that control how GrowthBook behaves.

### Attributes

You can specify attributes about the current user and request. These are used for two things:

1.  Feature targeting (e.g. paid users get one value, free users get another)
2.  Assigning persistent variations in A/B tests (e.g. user id "123" always gets variation B)

The following are some commonly used attributes, but use whatever makes sense for your application.

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

#### Updating Attributes

If attributes change, you can call `setAttributes()` to update. This will completely overwrite any existing attributes. To do a partial update, use the following pattern:

```js
gb.setAttributes({
  // Only update the `url` attribute, keep the rest the same
  ...gb.getAttributes(),
  url: "/new-page",
});
```

### Feature Usage Callback

GrowthBook can fire a callback whenever a feature is evaluated for a user. This can be useful to update 3rd party tools like NewRelic or DataDog.

```ts
new GrowthBook({
  onFeatureUsage: (featureKey, result) => {
    console.log("feature", featureKey, "has value", result.value);
  },
});
```

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

### Inline Experiments

Depending on how you configure feature flags, they may run A/B tests behind the scenes to determine which value gets assigned to the user.

Sometimes though, you want to run an inline experiment without going through a feature flag first. For this, you can use either the `useExperiment` hook or the Higher Order Component `withRunExperiment`:

View the [Javascript SDK Docs](https://docs.growthbook.io/lib/js) for all the options available for inline experiments

#### useExperiment hook

```sveltehtml
<script lang="ts">
  import { useExperiment } from "@growthbook/growthbook-svelte";

  const { value } = useExperiment({
    key: "new-headline",
    variations: ["Hello", "Hi", "Good Day"],
  });
</script>

<h1>{value}</h1>
```
