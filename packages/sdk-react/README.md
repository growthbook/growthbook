# GrowthBook React SDK

Powerful feature flagging and A/B testing for React.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-3.68KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook-react)

- **No external dependencies**
- **Lightweight and fast**
- **No HTTP requests** everything is defined and evaluated locally
- Works for both **client and server-side** rendering
- **Dev Mode** for testing variations and taking screenshots
- **No flickering or blocking calls**
- Written in **Typescript** with an extensive test suite
- Flexible experiment **targeting**
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- Run mutually exclusive experiments with **namespaces**
- **Adjust variation weights and targeting** without deploying new code

**Note**: This library is just for running A/B tests in React. To analyze results, use the GrowthBook App (https://github.com/growthbook/growthbook).

## Community

Join [our GrowthBook Users Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you need help, want to chat, or are thinking of a new feature. We're here to help - and to make GrowthBook even better.

## Installation

```
yarn add @growthbook/growthbook-react
```

or

```
npm install --save @growthbook/growthbook-react
```

## Quick Start

### Step 1: Configure your app

```tsx
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
  // Optional path to a JSON file with remote configuration data
  configEndpoint: "https://cdn.growthbook.io/config/key_abc123",

  // User attributes for targeting and variation assignment
  attributes: {
    id: "123",
    isPremium: true,
    country: "US",
  },

  // Called every time the user is put into an experiment
  trackingCallback: (experiment, result) => {
    // Mixpanel, Segment, GA, or custom tracking
    mixpanel.track("Experiment Viewed", {
      experiment: experiment.key,
      variation: result.variationId,
    });
  },
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

#### <FeatureValue>

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

## Experiments

Depending on how you configure feature flags, they may run A/B tests behind the scenes to determine which value to the user.

Sometimes though, you want to run an inline experiment without going through a feature flag first. For this, you can use either the `useExperiment` hook or the HoC `withRunExperiment`:

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

## Documentation

See the full documentation and more usage examples at https://docs.growthbook.io/lib/react
