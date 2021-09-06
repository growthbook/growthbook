# GrowthBook Front-End

This document is meant for developers who want to contribute to the GrowthBook platform.

## Architecture

- Typescript
- Next.js
- Bootstrap (CSS only)
- [React Icons](https://react-icons.github.io/react-icons)
- [visx](https://airbnb.io/visx) (data visualizations)
- [swr](https://swr.vercel.app/) (data fetching)
- date-fns
- lodash
- React Hook Form

## Forms

We use the React Hook Form library.

Basic usage:

```tsx
import { useForm } from "react-hook-form";

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
      <input type="text" {...form.register("firstName")} />
      <input type="text" {...form.register("lastName")} />
      <button type="submit">Submit</button>
    </form>
  );
}
```

Most commonly, forms are used within Modals. Modals handle the loading, submitting, and error states for you:

```tsx
import { useForm } from "react-hook-form";
import Modal from "../components/Modal";
import { useState } from "react";

function MyComponent() {
  const form = useForm({
    defaultValues: {
      firstName: "john",
      lastName: "smith",
    },
  });

  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Modal
        header="Edit Name"
        open={open}
        close={() => setOpen(false)}
        form={form}
        submit={async (data) => {
          console.log(data);
        }}
      >
        <input type="text" {...form.register("firstName")} />
        <input type="text" {...form.register("lastName")} />
      </Modal>
    </>
  );
}
```
