# Migrating legacy models to BaseModel

Migrating our legacy model classes to use BaseModel can be tricky and have hard-to-catch bugs due to interactions between code in and out of the diff. This guide will walk through the main steps in migrating a model as well as some of the important tests and possible failure points

## Creating the model class

Start by defining a `const BaseClass = MakeModelClass({` and populate the config appropriately

⚠️ If the model doesn’t have a validator in `shared/validators` yet, create one. If the Interface in `shared/types` is defined in native Typescript - convert it to `z.infer<typeof yourSchema>` and ensure the schema produces the same output interface (particularly optional fields). Lastly, make sure that the zod schema covers all the fields from the original `mongoose.schema`

⚠️ Double check the `collectionName` and `additionalIndexes` match existing behavior (e.g. unique fields)

Then, you can define the model class itself, removing the unused mongoose code

```typescript
export class MyModel extends BaseClass {
  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }
}
```

⚠️ These permission checks are one common source of bugs. Populate them with appropriate helpers from `this.context.permissions` but they may need overrides in some codepaths

## Absorbing helper methods

Most of our models have a number of helpers defined as exported functions in the model file. These should usually be pulled into the new model class as a `public` method, but some of them are redundant with built-ins of `BaseModel`, e.g. the `createFoo` helpers.

Some helpers can also be combined into one without much effort. This is a good time to try to reduce the complexity of the model if possible.

⚠️ Check if any of the helpers are exposing too much of the database layer of concern. Prefer passing explicit arguments like `maxDate?: Date` over arbitrary filters like `customFilter?: ScopedFilterQuery<...>`

## Replacing existing usage

Each of the helper methods that used to be imported directly will now need to be called via the context instead. Start by adding the new model to the context object in `services/context.ts` by updating `ModelName`, `modelClasses`, and `this.models`.

Then, find each usage of the old helper methods (you can check for broken imports with `pnpm type-check`) and replace it with a call to `(req/this).context.models.<model>.helper`. Update arguments as appropriate.

⚠️ Not all call-sites will have a context object available. Most of the time this is easy to work around by passing the context in from outside or using `getContextFromReq`/`getContextForAgendaJob...`. Sometimes, though, these call-sites will be outside the context of a single org and will need to be changed to a static method instead.

## Add necessary static methods

For the cases where we need to use the model outside an org’s context, we need to define `public static` helpers.

⚠️ These methods lack the in-org query protections built into `BaseModel`, so their names should be prefixed with `dangerous` to warn other devs to be cautious in their use.

⚠️ Static methods don't have access to `this.migrate`. If migration is necessary in any of the static methods, `migrate` should be moved to the static level like so:

```typescript
  protected static migrate(doc: unknown): MyModelInterface {
    const castDoc = doc as MyModelInterface;
    // migration logic
    return {};
  }
  protected migrate(doc: unknown) {
    return MyModel.migrate(doc);
  }
```
