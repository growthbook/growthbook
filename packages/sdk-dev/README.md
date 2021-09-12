# GrowthBook SDK Dev Mode

Adds a widget to your site that helps during development of GrowthBook A/B tests.

Currently only supports client-side SDKs (**javascript** and **react**). Server-side support is coming soon!

**Only for use on development/staging builds. Do not use in production!!!**

![Dev Mode Variation Switcher](variation-switcher.png)

## Usage

To use, simply add a script tag to your development HTML:

```html
<script
  async
  src="https://unpkg.com/@growthbook/dev/dist/bundles/index.min.js"
></script>
```

OR if you are using the GrowthBook React SDK, you can render the dev mode component directly if you prefer:

```jsx
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { GrowthBookDev } from "@growthbook/dev";

const growthbook = new GrowthBook({
  user: { id: "1" },
});

export default function MyApp() {
  return (
    <>
      <GrowthBookProvider growthbook={growthbook}>
        <App />
      </GrowthBookProvider>
      {process.env.NODE_ENV !== "production" && (
        <GrowthBookDev growthbook={growthbook} />
      )}
    </>
  );
}
```
