<div style="text-align: center; margin: 0 auto; max-width: 500px">
    <img src="https://docs.growthbook.io/img/growthbook-docslogo-light.png" />
</div>

Documentation around how to install, set up, and use GrowthBook, the open source A/B testing platform.

View these hosted docs at https://docs.growthbook.io

## Contributing

We welcome contributions of all sizes, and especially to the Docs. To start working on the docs, you can either edit the markdown files directly in GitHub, or clone the repo and run the docs locally.
To get the docs running locally, you can follow the [contributing guide](https://github.com/growthbook/growthbook/blob/main/CONTRIBUTING.md).

Docs are built using [Docusaurus](https://docusaurus.io/), and are written in markdown. The docs are located in the `docs/docs` directory.

To run the docs locally, first `cd docs`. If this is the first time you're running the docs, you'll need to run `pnpm install` to install the packages. Once the packages are installed, run `pnpm dev` to start the docs server. The docs will be available at http://localhost:3200. You can also consider running `pnpm build` which will ask Docusaurus to run more tests.

## Custom Components

### MaxWidthImage

Use `MaxWidthImage` for displaying images in the documentation with a maximum width constraint, helping images fit nicely on the page regardless of their original size. To use it, import `MaxWidthImage` at the top of your markdown (MDX) file:

```jsx
import MaxWidthImage from "@site/src/components/MaxWidthImage";
```

Then, wrap your image markdown inside the component like this:

```jsx
<MaxWidthImage>![Alt text](/images/example.png)</MaxWidthImage>
```

Here are the available props for `MaxWidthImage`:

- **maxWidth** (_number or string, optional_): Sets the maximum width of the image in pixels (e.g., `500` or `"500px"`). If not specified, uses the default.
- **border** (_boolean, optional_): If true, adds a border around the image.

Example usage with props:

```jsx
<MaxWidthImage maxWidth={300} border>
  ![Descriptive alt text](/images/example-image.png)
</MaxWidthImage>
```

You can combine these props as needed to control the appearance of your images in documentation.

You can optionally adjust the `maxWidth` prop to control how wide the image can appear. Other props such as `border` can be provided for additional styling.

### Stepper

The `Stepper` component is a custom component used to display a sequence of steps, making instructions or multi-step guides easier to follow. To use it, first import the component near the top of your markdown file:

```jsx
import { Stepper, Step } from "@site/src/components/Stepper";
```

Then, structure your steps within the component:

```jsx
<Stepper>
  <Step title="Step 1">
    Description or content for step 1.
  </Step>
  <Step title="Step 2">
    Content for step 2.
  </Step>
  <!-- Add more <Step> as needed -->
</Stepper>
```

Each `Step` can have a `title` (or other props) and step content inside. This helps present procedures in a consistent, visually appealing format.

### CommercialFeature

Use `CommercialFeature` to indicate that a feature requires a paid plan (Pro or Enterprise). It renders a styled notice with the plan badge and feature name. To use it, import the component at the top of your MDX file:

```jsx
import CommercialFeature from "@site/src/components/CommercialFeature";
```

Then add the notice by passing a valid `feature` key:

```jsx
<CommercialFeature feature="multi-org" />
```

This renders a notice like: **[Enterprise]** **Multi Org** is available on Enterprise plans.

The component accepts the following props:

- **feature** (_string, required_): The feature key matching an entry in `docs/src/data/commercialFeatures.ts`. The plan level (Pro or Enterprise) and display name are resolved automatically from this key.
- **description** (_string, optional_): Extra text appended after the default plan description. Use this to add context specific to the page.

Example with a custom description:

```jsx
<CommercialFeature
  feature="schedule-feature-flag"
  description="Contact sales for a demo."
/>
```

#### Keeping the feature data up to date

The data file `docs/src/data/commercialFeatures.ts` is **auto-generated** from the source of truth in `packages/shared/src/enterprise/license-consts.ts`. Do not edit it by hand. If you need to add or change a commercial feature, update `license-consts.ts` and then run:

```bash
pnpm --filter shared gen-commercial-features-for-docs
```

This will also run automatically via the pre-commit hook whenever `license-consts.ts` or the generation script changes.
