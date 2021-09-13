# GrowthBook React SDK

Powerful A/B testing for React.

![Build Status](https://github.com/growthbook/growthbook/workflows/CI/badge.svg) ![GZIP Size](https://img.shields.io/badge/gzip%20size-2.3KB-informational) ![NPM Version](https://img.shields.io/npm/v/@growthbook/growthbook-react)

- **No external dependencies**
- **Lightweight and fast**
- **No HTTP requests** everything is defined and evaluated locally
- Works for both **client and server-side** rendering
- **Dev Mode** for testing variations and taking screenshots
- **No flickering or blocking calls**
- Written in **Typescript** with an extensive test suite
- Flexible experiment **targeting**
- **Use your existing event tracking** (GA, Segment, Mixpanel, custom)
- **Adjust variation weights and targeting** without deploying new code

**Note**: This library is just for running A/B tests in React. To analyze results, use the GrowthBook App (https://github.com/growthbook/growthbook).

## Community

Join [our GrowthBook Users Slack community](https://join.slack.com/t/growthbookusers/shared_invite/zt-oiq9s1qd-dHHvw4xjpnoRV1QQrq6vUg) if you need help, want to chat, or are thinking of a new feature. We're here to help - and to make GrowthBook even better.

## Installation

`yarn add @growthbook/growthbook-react`

or

`npm install --save @growthbook/growthbook-react`

## Quick Start

### Step 1: Configure your app

```tsx
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
  // The attributes you want to use to assign variations
  user: {
    id: "123",
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

### Step 2: Run an experiment

#### Hooks (recommended)

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

#### Class Components

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
