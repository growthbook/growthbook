# GrowthBook React SDK

[GrowthBook](https://www.growthbook.io) is a modular Feature Flagging and Experimentation platform.

This is the React client library that lets you evaluate feature flags and run experiments (A/B tests) within a React application. It is a thin wrapper around the [Javascript SDK](https://docs.growthbook.io/lib/js), so you might want to view those docs first to familiarize yourself with the basic classes and methods.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-4.18KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook-react)

- **No external dependencies**
- **Lightweight and fast**
- Local targeting and evaluation, **no HTTP requests**
- Works for both **client and server-side** rendering as well as **React Native**
- **No flickering** when running A/B tests
- Written in **Typescript** with extensive test coverage
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Remote configuration** to change feature values without deploying new code

## Community

Join [our GrowthBook Users Slack community](https://slack.growthbook.io?ref=react-readme) if you need help, want to chat, or are thinking of a new feature. We're here to help - and to make GrowthBook even better.

## Installation

```
yarn add @growthbook/growthbook-react
```

or

```
npm install --save @growthbook/growthbook-react
```

## Quick Usage

### Step 1: Configure your app

```tsx
import { useEffect } from "react";
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";

// Create a GrowthBook instance
const gb = new GrowthBook({
  apiHost: "https://cdn.growthbook.io",
  clientKey: "sdk-abc123",
  // Enable easier debugging of feature flags during development
  enableDevMode: true,
});

export default function App() {
  useEffect(() => {
    // Load features from the GrowthBook API
    gb.loadFeatures();
  }, []);

  useEffect(() => {
    // Set user attributes for targeting (from cookie, auth system, etc.)
    gb.setAttributes({
      id: user.id,
      company: user.company,
    });
  }, [user]);

  return (
    <GrowthBookProvider growthbook={gb}>
      <OtherComponent />
    </GrowthBookProvider>
  );
}
```

### Step 2: Start feature flagging!

There are a few ways to use feature flags in GrowthBook:

#### Feature Hooks

```tsx
import { useFeatureValue, useFeatureIsOn } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  // Boolean on/off features
  const newLogic = useFeatureIsOn("new-login-form");

  // String/Number/JSON features with a fallback value
  const buttonColor = useFeatureValue("login-button-color", "blue");

  if (newLogin) {
    return <NewLogin color={buttonColor} />;
  } else {
    return <Login color={buttonColor} />;
  }
}
```

#### Feature Wrapper Components

```tsx
import { IfFeatureEnabled, FeatureString } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  return (
    <div>
      <h1>
        <FeatureString feature="site-h1" default="My Site" />
      </h1>
      <IfFeatureEnabled feature="welcome-message">
        <p>Welcome to our site!</p>
      </IfFeatureEnabled>
    </div>
  );
}
```

#### useGrowthBook hook

If you need low-level access to the GrowthBook instance for any reason, you can use the `useGrowthBook` hook.

One example is updating targeting attributes when a user logs in:

```jsx
import { useGrowthBook } from "@growthbook/growthbook-react";

export default function Auth() {
  const growthbook = useGrowthBook();

  const user = useUser();
  useEffect(() => {
    if (!user || !growthbook) return;
    growthbook.setAttributes({
      loggedIn: true,
      id: user.id,
      company: user.company,
      isPro: user.plan === "pro"
    })
  }, [user, growthbook])

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

## The GrowthBook Instance

The `GrowthBook` constructor takes a number of optional settings.

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

### Feature Usage Callback

GrowthBook can fire a callback whenever a feature is evaluated for a user. This can be useful to update 3rd party tools like NewRelic or DataDog.

```ts
new GrowthBook({
  onFeatureUsage: (featureKey, result) => {
    console.log("feature", featureKey, "has value", result.value);
  },
});
```

The `result` argument is the same thing returned from the `useFeature` hook.

Note: If you evaluate the same feature multiple times (and the value doesn't change), the callback will only be fired the first time.

### Dev Mode

You can enable Dev Mode by passing `enableDevMode: true` when you create a new GrowthBook Context. Doing so will provide you with a much better developer experience when getting started.

Enabling Dev Mode allows you to test and debug with GrowthBook's Chrome DevTools Extension.

```js
const gb = new GrowthBook({
  // Set enableDevMode to true to use the Chrome DevTools Extension to aid testing/debugging.
  enableDevMode: true,
});
```

## Server Side Rendering (SSR)

This SDK fully supports server side rendering. The below example is using Next.js, but other frameworks should be similar.

First, create a helper function to generate GrowthBook SSR props from an incoming request

```js
// util/gb-server.js
import { getGrowthBookSSRData } from "@growthbook/growthbook-react";

export async function generateGrowthBookSSRProps(context) {
  return getGrowthBookSSRData({
    apiHost: process.env.NEXT_PUBLIC_GROWTHBOOK_API_HOST,
    clientKey: process.env.NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY,
    attributes: {
      // TODO: get more targeting attributes from request context
      id: context.req.cookies.DEVICE_ID,
    },
  });
}
```

Then, on a server rendered page, call this helper and pass it into the `useGrowthBookSSR` hook:

```jsx
// pages/server.jsx
import MyComponent from "../components/MyComponent";
import { generateGrowthBookSSRProps } from "../util/gb-server";
import { useGrowthBookSSR } from "@growthbook/growthbook-react";

export async function getServerSideProps(context) {
  const gbData = await generateGrowthBookSSRProps(context);
  return {
    props: {
      gbData,
    },
  };
}

export default function ServerPage({ gbData }) {
  // This is required once at the top of the SSR page
  useGrowthBookSSR(gbData);

  return <MyComponent />;
}
```

In the rest of your app, just use the same hooks and components as client-side rendering (`useFeature`, `<IfFeatureEnabled>`, etc.)

## Inline Experiments

Depending on how you configure feature flags, they may run A/B tests behind the scenes to determine which value gets assigned to the user.

Sometimes though, you want to run an inline experiment without going through a feature flag first. For this, you can use either the `useExperiment` hook or the Higher Order Component `withRunExperiment`:

### useExperiment hook

```tsx
import { useExperiment } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  const { value } = useExperiment({
    key: "new-headline",
    variations: ["Hello", "Hi", "Good Day"],
  });

  return <h1>{value}</h1>;
}
```

### Class Components

**Note:** This library uses hooks internally, so still requires React 16.8 or above.

```tsx
import { withRunExperiment } from "@growthbook/growthbook-react";

class OtherComponent extends React.Component {
  render() {
    // The `runExperiment` prop is identical to the `useExperiment` hook
    const { value } = this.props.runExperiment({
      key: "headline-test",
      variations: ["Hello World", "Hola Mundo"],
    });
    return <h1>{value}</h1>;
  }
}
// Wrap your component in `withRunExperiment`
export default withRunExperiment(OtherComponent);
```
