# GrowthBook Front-End

This document is meant for developers who want to contribute to the GrowthBook platform. It covers the following topics:

- Interacting with the API
- Forms
- Searching and Sorting
- Global Context (coming soon)
- Modals (coming soon)
- Visualizations (coming soon)
- Tabs and Dropdowns (coming soon)
- Authentication (coming soon)

## Interacting with the API

There are two main ways to interact with the GrowthBook API. First is the `useApi` hook for fetching data for a component. Second is the `apiCall` function for making calls in response to user actions.

### useApi

If a page or component relies on data from the API, it can use the `useApi` hook.
This uses swr under the hood and will automatically take care of caching and refreshing.

```tsx
import useApi from "@/hooks/useApi";

function MyComponent({ id }) {
  // Describe the shape of the returned data with Typescript types
  const { data, error } = useApi<{
    people: {
      id: string;
      name: string;
    }[];
  }>(`/people`);

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <ul>
      {data.people.map(({ id, name }) => (
        <li key={id}>{name}</li>
      ))}
    </ul>
  );
}
```

The `useApi` hook also returns a `mutate` function that can be called to force a refresh from the server.

This hook takes an optional 2nd options argument to configure the behavior. Below are all of the possible options with descriptions

```js
useApi(`/people`, {
  // If this returns false, the API call will not be made
  // Useful for dependencies between API calls
  // Defaults to always return true
  shouldRun: () => isReady,
  // If false, the API call will never refresh automatically
  // You can still call `mutate` to manually refresh
  // Defaults to true
  autoRevalidate: false,
  // Set to false if your API call does not depend on the current org
  // For example: changing a user's password
  // You should almost never need to change this
  // Defaults to true
  orgScoped: true,
});
```

### apiCall

Use `apiCall` to make an authenticated call to the API in response to a user action - for example, clicking a submit button on a form. It is a simple wrapper around `window.fetch` that adds authentication and content-type headers and parses responses.

If your API call returns a status other than `200`, it will throw an error that you can catch.

```tsx
import { useAuth } from "@/services/auth";

function MyComponent() {
  const { apiCall } = useAuth();

  return (
    <button
      onClick={async (e) => {
        e.preventDefault();
        try {
          // Describe the shape of the API response with Typescript types
          const response = await apiCall<{ id: string }>("/ideas", {
            method: "PUT",
            body: JSON.stringify({
              text: "My Idea",
            }),
          });

          console.log(response.id);
        } catch (e) {
          console.error("Failed to created", e);
        }
      }}
    >
      Create Idea
    </button>
  );
}
```

## Forms

We use the React Hook Form library plus a custom `Field` component.

Basic usage:

```tsx
import { useForm } from "react-hook-form";
import Field from "@/components/Forms/Field";

function MyComponent() {
  const form = useForm({
    defaultValues: {
      firstName: "john",
      lastName: "smith",
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((data) => {
        console.log(data.firstName, data.lastName);
      })}
    >
      <Field label="First Name" {...form.register("firstName")} />
      <Field label="Last Name" {...form.register("lastName")} />
      <button type="submit">Submit</button>
    </form>
  );
}
```

The `Field` component helps keep a consistent UI throughout the app. It is very flexible and can render `<input>`, `<select>`, `<textarea>`, and custom elements. Core properties shared between all input types:

- **label** (string or ReactElement)
- **error** (string or ReactElement)
- **helpText** (string or ReactElement)
- **prepend** (string) - alternative to labels that is more compact
- **apend** (string) - use to give units for numeric inputs (e.g. `%` or `users/day`)
- **containerClassName** (string)
- **labelClassName** (string)

Any normal HTML props can be passed as well and will be passed onto the underlying input element.

### Select Dropdowns

Use the `SelectField` component to render a dropdown.

It has many of the same properties as `Field`, but there are 2 main differences:

1. Must pass in `options`
2. Cannot use `form.register`. Instead specify a `value` and `setValue` prop.

Example:

```tsx
<SelectField
  options={[
    {value: "1", label: "One"},
    {value: "2", label: "Two"}
  ]}
  value={form.watch("myField")}
  setValue={(val) => form.setValue("myField", val)}
>
```

There is also a `MultiSelectField` component where the value is an array of strings instead of a single string.

Both `SelectField` and `MultiSelectField` have a `createable` prop that makes it act more like an auto-complete field than a true dropdown.

### Textareas

Textareas use the `TextareaAutosize` component to dynamically adjust height based on the contents. There are 3 additional props you can specify:

- **textarea** (required, `true`)
- **minRows** (optional, default `2`)
- **maxRows** (optional, default `6`) - content longer than this will have a scrollbar

Example:

```tsx
<Field label="Description" textarea maxRows={20} />
```

### Custom Inputs

There is also a `render` prop for completely custom inputs.

```tsx
<Field
  label="Price"
  render={(id, ref) => {
    return <MyPriceInput id={id} ref={ref} />;
  }}
/>
```

## Searching, Sorting, and Pagination

Whenever we show a list of items, we typically render a table and provide searching and sorting functionality.

The `useSearch` hook makes this process much simpler and removes a lot of boilerplate code.

### Basic Usage

```tsx
// List of items from the API
const features: FeatureInterface[];

// Filter by search term and sort results
const { items, searchInputProps, SortableTH, pagination } = useSearch({
  items: features,
  localStorageKey: "features",
  searchFields: ["id", "description"],
  defaultSortField: "id",
  pageSize: 20,
});

// Render the UI
return (
  <div>
    <div className="row mb-2">
      <div className="col-auto">
        <Field placeholder="Search..." type="search" {...searchInputProps} />
      </div>
    </div>
    <table className="table">
      <thead>
        <SortableTH field="id">Feature ID</SortableTH>
        <SortableTH field="description">Description</SortableTH>
        <th>Non-sortable Column</th>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>{item.description}</td>
            <td>{item.somethingElse}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {pagination}
  </div>
);
```

### Sort by Date

The default sort direction is ascending, but you can change it if needed. This is commonly done with date columns when you want to show most recent first.

```ts
useSearch({
  ...
  defaultSortField: "dateCreated",
  defaultSortDir: -1, // Sort descending by default
});
```

### Filtering results

Sometimes you need to filter results by more than just the search term. For example, if you have a toggle on the page that controls whether or not archived items are included.

```ts
const [showArchived, setShowArchived] = useState(false);

// Make sure to use `useCallback` to avoid costly re-renders
const filterResults = useCallback(
  (features: FeatureInterface[]) => {
    return features.filter((feature) => showArchived || !feature.archived);
  },
  [showArchived],
);

useSearch({
  items: features,
  localStorageKey: "features",
  searchFields: ["id", "description"],
  defaultSortField: "id",
  filterResults,
});
```

### Field weighting

Not all fields in an object are created equal. You can specify weighting to make some fields more important than others when searching.

```ts
useSearch({
  items: features,
  localStorageKey: "features",
  // Boost `id` weight to 2, default weight is 1
  searchFields: ["id^2", "description"],
  defaultSortField: "id",
  filterResults,
});
```

### Add computed properties

Sometimes you need to add additional properties to items before you can effectively search and sort them. For example, if your items have a `metricId` field, that's not very useful since they are stored as opaque strings (e.g. `met_abc123`) instead of recognizable names.

There's a hook `useAddComputedFields` to help with this:

```tsx
const { getMetricById } = useDefinitions();

// Add a `metricName` property to each item
const withMetricNames = useAddComputedFields(
  myItems,
  (item) => ({
    metricName: getMetricById(item.metricId)?.name || "",
  }),
  // Dependencies
  [getMetricById],
);

const { items, SortableTH } = useSearch({
  items: withMetricNames,
  localStorageKey: "my-page",
  // Reference the computed fields in searchFields
  searchFields: ["id", "metricName"],
  defaultSortField: "id",
});

return (
  <table className="table">
    <thead>
      <SortableTH field="id">Id</SortableTH>
      {/* Reference computed fields in SortableTH */}
      <SortableTH field="metricName">Metric</SortableTH>
    </thead>
    <tbody>
      {items.map((item) => (
        <tr key={item.id}>
          <td>{item.id}</td>
          {/* Computed fields are available here too! */}
          <td>{item.metricName}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
```

**Note**: Make sure to pass dependencies into the `useAddComputedFields` hook (e.g. `getMetricById` in the example above).

### Handling empty states

If the user searches for something and there are no results, it's helpful to provide an easy way to clear their search term. The hook returns a boolean `isFiltered` flag and a `clear` function to help with this.

```tsx
const { items, isFiltered, clear } = useSearch({
  items: features,
  fields: ["id", "description"],
});

return (
  <table>
    <thead>...</thead>
    <tbody>
      {items.length > 0 ? (
        items.map((item) => <tr>...</tr>)
      ) : (
        <tr>
          <td colSpan={4}>
            <em>No results found</em>{" "}
            {isFiltered && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  clear();
                }}
              >
                Clear filters
              </a>
            )}
          </td>
        </tr>
      )}
    </tbody>
  </table>
);
```

### Pagination

By default, pagination is disabled. Specify a `pageSize` in the `useSearch` hook to enable it.

There are also 3 return properties from the hook:

- `pagination` - Make sure to render this right after your table
- `page` - The current page
- `resetPage` - A callback you can call to reset to page 1

Note: Pagination is done client-side and does not reduce the memory consumption or network usage. It can however reduce CPU by limiting the number of components rendered to the screen.

### Custom search syntax (advanced)

Sometimes we want to add support for custom syntax to the search box. For example, on the features page, we allow searching by toggled environment (e.g. `on:dev`).

This is handled by the `searchTermFilters` parameter in the `useSearch` hook, which lets you define custom filters. This is run before `filterResults` (if specified).

Here's a simplified example:

```ts
useSearch({
  items: features,
  localStorageKey: "features",
  searchFields: ["id", "description"],
  defaultSortField: "id",
  searchTermFilters: {
    version: (feature) => feature.version,
    type: (feature) => feature.valueType,
    created: (feature) => feature.dateCreated,
    on: (feature) => {
      // Build a list of all environments where this feature is on
      const on: string[] = [];
      environments.forEach((e) => {
        if (isEnvEnabled(feature, e)) on.push(e);
      });
      return on;
    },
  },
});
```

Now, the following queries will work as expected:

- `on:production` - search for a match in an array of strings
- `type:^bool` - prefix match (actual type is "boolean")
- `version:>2 version:<10 version:!5` - supports numbers and modifiers
- `created:2024-01` - ISO date support with prefix matching by default
