# GrowthBook Back-End

This document is meant for developers who want to contribute to the GrowthBook platform. It covers the following topics:

- Editing data models

## Editing data models

In order to preform CRUD operations on the data model there are 3 places you will need to contribute to and a potential 4th.  
`models/exampleModel.ts`, `types/example.d.ts`, `controllers/example.ts`, and optionally if you are gathering data from the
front-end `front-end/pages/example/index.tsx`.

### `models/exampleModel.ts`

defines the model for mongoose ORM. Complex datatypes are NOT allowed.

```tsx
const exampleSchema = new mongoose.Schema({
  foo: String,
  bar: {
    x: String,
    y: Boolean,
    z: Date,
    w: Number,
  },
});
```

### `types/example.d.ts`

defines the type that can be used internally. Complex datatypes ARE allowed.

```tsx
interface BarI {
  x: String;
  y: Boolean;
  z: Date;
  w: Number;
}

const exampleSchema = new mongoose.Schema({
  foo: String,
  bar: BarI,
});
```

### `controllers/example.ts`

contains the definitions for various CRUD operations. Reference existing controllers for example code. If you need to add
a new endpoint add it to `backend/src/app.ts`.

### `front-end/pages/example/index.tsx`

if data is changing via the front-end you will need to make sure and provide the change wherever the API request is being
made via the `front-end`
