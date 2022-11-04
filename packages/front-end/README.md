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
import useApi from "../hooks/useApi";

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

### apiCall

Use `apiCall` to make an authenticated call to the API in response to a user action - for example, clicking a submit button on a form. It is a simple wrapper around `window.fetch` that adds authentication and content-type headers and parses responses.

If your API call returns a status other than `200`, it will throw an error that you can catch.

```tsx
import { useAuth } from "../services/auth";

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
import Field from "../components/Forms/Field";

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

Select dropdowns have 2 additional props:

- **options** (required)
- **initialOption** (optional, string)

The `options` prop can be an array of strings, an array of `{value: "...", display: "..."}` objects, or an object mapping (e.g. `{fname: "First Name", lname: "Last Name"}`). Use the `initialOption` prop if you want to add a blank option to the top of the list (e.g. `Choose one...`).

Examples:

```tsx
<Field initialOption="Pick One" options={["one", "two"]}/>

<Field options={[
  {value: "1", display: "One"},
  {value: "2", display: "Two"},
]}/>

<Field options={{
  "1": "One",
  "2": "Two",
}}/>
```

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

## Searching and Sorting

On our "list" pages, we typically render a table and provide searching and sorting functionality.

The `useSearch` and `useSort` hooks make this process much simpler and remove a lot of boilerplate code.

### Basic Usage

```tsx
// List of items from the API
const features: FeatureInterface[];

// Filter by search term
const { list, searchInputProps, isFiltered } = useSearch({
  items: features,
  fields: ["id", "description"],
});

// Sort the list
const { sorted, SortableTH } = useSort({
  defaultField: "id",
  fieldName: "features", // Unique name for persisting in localStorage
  items: list,
  isFiltered,
});

// Render the UI
return (
  <div>
    <div className="row mb-2">
      <div className="col-auto">
        <Field placeholder="Search..." {...searchInputProps} />
      </div>
    </div>
    <table className="table">
      <thead>
        <SortableTH field="id">Feature ID</SortableTH>
        <SortableTH field="description">Description</SortableTH>
        <th>Non-sortable Column</th>
      </thead>
      <tbody>
        {sorted.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>{item.description}</td>
            <td>{item.somethingElse}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

### Filtering results

Sometimes you need to filter results by more than just the search term. For example, if you have a toggle on the page that controls whether or not archived items are included.

```ts
const [showArchived, setShowArchived] = useState(false);

const { list, searchInputProps, isFiltered } = useSearch({
  items: features,
  fields: ["id", "description"],
  filterResults: (features: FeatureInterface[]) => {
    return features.filter((feature) => showArchived || !feature.archived);
  },
  dependencies: [showArchived],
});
```

Note: **dependencies** are passed into a `useCallback` hook, so make sure they contain everything needed for the `filterResults` function.

### Field weighting

Not all fields in an object are created equal. You can specify weighting to make some fields more important than others when searching.

```ts
const { list, searchInputProps, isFiltered } = useSearch({
  items: features,
  fields: [
    // Increase the weight of this field to 2
    { name: "id", weight: 2 },
    // Default weight is 1
    "description",
  ],
});
```

### Add computed properties

Sometimes you need to add additional properties to items before you can effectively search and sort them. For example, if your items have a `metricId` field, that's not very useful for searching since they are stored as opaque strings (e.g. `met_abc123`).

There's a hook `useAddComputedFields` to help with this:

```tsx
const { getMetricById } = useDefinitions();

// Add a `metricName` property to each item
const withMetricNames = useAddComputedFields(items, (item) => ({
  metricName: getMetricById(item.metricId)?.name || "",
}));

// Use the computed field in your search
const { list, searchInputProps, isFiltered } = useSearch({
  items: withMetricNames,
  fields: ["id", "metricName"],
});

// ...

// Use the computed field in your `SortableTH`
return <SortableTH field="metricName">Metric</SortableTH>;
```

### Handling empty states

If the user searches for something and there are no results, it's helpful to provide an easy way to clear their search term.

```tsx
// 'clear' is a function you can call to reset the search term
const { list, searchInputProps, isFiltered, clear } = useSearch({
  items: features,
  fields: ["id", "description"],
});

// ...

return (
  <table>
    <thead>...</thead>
    <tbody>
      {list.length > 0 ? (
        list.map((item) => <tr>...</tr>)
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

### Special search syntax (advanced)

Sometimes we want to add support for special syntax to the search box. For example, on the features page, we allow searching by toggled environment (e.g. `on:dev`).

This is handled by the `transformQuery` parameter in the `useSearch` hook, which lets you modify the search term before it's processed by our search engine. Then, you can use `filterResults` to apply your custom logic.

Here's a simplified example:

```ts
const regex = /(\s|^)on:([^s]*)/g;

const {list, searchInputProps, isFiltered} = useSearch({
  items: features,
  fields: ["id", "description"],
  transformQuery: (q: string) => q.replace(regex, ''),
  filterResults: (results: FeatureInterface[], originalQuery: string) {
    // Get the filtered environment (if any) and filter results by it
    const env = originalQuery.match(regex)?.[2];
    if (env) {
      results = results.filter(feature => isEnvEnabled(feature, env))
    }

    return results;
  },
  dependencies: []
});
```
