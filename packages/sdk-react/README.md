# GrowthBook React SDK

[GrowthBook](https://www.growthbook.io) is a modular Feature Flagging and Experimentation platform.

This is the React client library that lets you evaluate feature flags and run experiments (A/B tests) within a React application. It is a thin wrapper around the [Javascript SDK](https://docs.growthbook.io/lib/js), so you might want to view those docs first to familiarize yourself with the basic classes and methods.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-3.82KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook-react)

- **No external dependencies**
- **Lightweight and fast**
- Local targeting and evaluation, **no HTTP requests**
- Works for both **client and server-side** rendering
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
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
  // enableDevMode: true allows you to use the Chrome DevTools Extension to test/debug.
  enableDevMode: true,
});

// Load feature definitions (from API, database, etc.)
await fetch("https://s3.amazonaws.com/myBucket/features.json")
  .then((res) => res.json())
  .then((parsed) => {
    growthbook.setFeatures(parsed);
  });

export default function App() {
  return (
    <GrowthBookProvider growthbook={growthbook}>
      <OtherComponent />
    </GrowthBookProvider>
  );
}
```

### Step 2: Start feature flagging!

There are a few ways to use feature flags in GrowthBook:

#### useFeature hook

```tsx
import { useFeature } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  // Boolean on/off flags
  const newLogin = useFeature("new-login-form").on;

  // Multivariate or string/JSON values
  const buttonColor = useFeature("login-button-color").value || "blue";

  if (newLogin) {
    return <NewLogin color={buttonColor} />;
  } else {
    return <Login color={buttonColor} />;
  }
}
```

#### <IfFeatureEnabled>

```tsx
import { IfFeatureEnabled } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  return (
    <div>
      <h1>Hello!</h1>
      <IfFeatureEnabled feature="welcome-message">
        <p>Welcome to our site!</p>
      </IfFeatureEnabled>
    </div>
  );
}
```

#### <FeatureString>

```tsx
import { FeatureString } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  return (
    <div>
      <h1>
        <FeatureString feature="site-h1" default="My Site" />
      </h1>
    </div>
  );
}
```

#### useGrowthBook hook

If you need low-level access to the GrowthBook instance for any reason, you can use the `useGrowthBook` hook:

```tsx
import { useGrowthBook } from "@growthbook/growthbook-react";

export default function OtherComponent() {
  // Identical to: const feature = useFeature("my-feature")
  const growthbook = useGrowthBook();
  const feature = growthbook.feature("my-feature");
}
```

### Step 3: Use Targeting Attributes

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

### Step 4: Set up a Tracking Callback

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

### Dev Mode

You can enable Dev Mode by passing `enableDevMode: true` when you create a new GrowthBook Context. Doing so will provide you with a much better developer experience when getting started.

Enabling Dev Mode allows you to test and debug with GrowthBook's Chrome DevTools Extension.

```js
const growthbook = new GrowthBook({
  // Set enableDevMode to true to use the Chrome DevTools Extension to aid testing/debugging.
  enableDevMode: true,
});
```
