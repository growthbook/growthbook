# GrowthBook Back-End

This document is meant for developers who want to contribute to the GrowthBook platform. It covers the following topics:

- Permissions
- Free vs Commercial Features
- Data Models
- Tests

More coming soon!

## Permissions

Users in GrowthBook have roles which grant them permissions to do various actions. Any endpoint which creates, edits, or deletes should check permissions as part of request handler.

Permissions have one of 3 "scopes":

- Environment (e.g. `publishFeatures`)
- Project (e.g. `createIdea`)
- Global (e.g. `manageTeam`)

There is a `req.checkPermissions` function you can use in your request handlers. It will throw an Exception if the current user does not have access.

```ts
// Global-scoped permission
req.checkPermissions("manageTeam");

// Project-scoped permission
req.checkPermissions("createIdea", "my-project");

// Environment-scoped permission
req.checkPermissions("publishFeatures", "my-project", ["dev"]);
```

Typescript will warn you if you use the wrong arguments for a permission (e.g. `req.checkPermissions("publishFeatures")` will be an error since you forgot to pass in project and environments).

For more complex actions that do multiple things, you may need to call `req.checkPermissions` multiple times.

### Adding new permissions

If you need to add new permissions, you'll need to update the `src/util/organization.util.ts` file in a couple places:

- Add your permission to either the `GLOBAL_PERMISSIONS`, `PROJECT_SCOPED_PERMISSIONS`, or `ENV_SCOPED_PERMISSIONS` constant
- In the `getRoles` function, add the permission to all roles that should have access to it

You'll also need to update the front-end `services/UserContext.tsx` and add it to the `DEFAULT_PERMISSIONS` constant.

## Free vs Commercial Features

GrowthBook follows an "Open Core" model, where the majority of the application is free and open source, but there are commercial features added on top that require a paid license.

It's also sometimes necessary to differentiate between self-hosted deployments and GrowthBook Cloud. We try to keep these checks to a minimum in the code to make the platform easier to test and maintain.

There are currently only a few commercial features defined in the code, but more will be added in the future.

There is a helper function to check if a commercial feature is available to the current organization:

```ts
if (orgHasPremiumFeature(req.org, "sso")) {
  // ...
}
```

And an environment variable to check if you are on GrowthBook Cloud:

```ts
if (IS_CLOUD) {
  // ...
}
```

### Adding new commercial features

If you want to add a new commercial feature, there are a few files you'll need to edit on the back-end:

- `types/organization.d.ts` - Add to the `CommercialFeature` union type
- `src/util/organizzation.util.ts` - Edit the `accountFeatures` map, which defines which plans have access to which features

## Data Models

GrowthBook uses MongoDB and Mongoose. Each database collection has a few corresponding files:

- A Typescript type definition in `types/MODEL_NAME.d.ts`
- A Mongoose schema in `src/models/MODEL_NAME.ts`

### Editing an existing data model

If you want to add/change a field on an existing data model, in addition to the type definition and mongoose schema listed above, you may also have to change the following:

- Controllers in `src/controllers/`
- Service files in `src/services/`
- Front-end pages or components

### Adding a new data model

A good example to copy is `src/models/ProjectModel.ts`. A few things to note:

- The schema and model are NOT exported. The only thing
- All methods which return documents are doing `toJSON()` first and returning plain objects instead of Mongoose objects
- None of the "find" methods take a MongoDB query as input, they take explicit fields instead

All of the above help keep the database-specific logic constrained to the Model file, which is easier to maintain.

In addition to the type definitions and the model file, you also probably want to add API endpoints to perform CRUD operations on your model. This is done with "controller" files.

A good example to copy is `src/controllers/projects.ts`.

Each API endpoint defined there:

1. Checks permissions
2. Gets user inputs
3. Performs validation (if needed)
4. Calls exported Model functions to update the database
5. Returns a response

To make it available from the front-end, you'll need to import your controller and register the request handler functions in `src/app.ts`.

## Tests

We use Jest to write tests on the back-end.

To avoid pulling in Mongo dependencies, all tested code should be in small standalone util files that do not import db models.

## REST API endpoints

_Coming soon_

## Sample Data

To use the analysis parts of GrowthBook, you need to connect to a data source with experimentation events.

We have a sample data generator script you can use to seed a Postgres database with realistic website traffic:

1. Run `yarn workspace back-end generate-dummy-data`. This will create CSV files in `/tmp/csv`
2. Start Postgres locally
3. Connect to your local Postgres instance using `psql`
4. Run the SQL commands in `packages/back-end/test/data-generator/create.sql` to create the tables and upload the generated data

Example running psql with create.sql

```bash
> psql -U postgres -d growthbook_db -a -f packages/back-end/test/data-generator/create.sql
```

Next, you'll need to set up the Postgres connection within GrowthBook.

1. Under Analysis->Data Sources, add a new data source
2. Select "Custom Event Source"
3. Select Postgres and enter your connection info. If you are running with `yarn dev`, you can use `localhost` safely and ignore the warning in the UI about docker.
4. On the data source page, you can add two identifier types: `user_id` and `anonymous_id`
5. Add an Identifier Join table:

```sql
SELECT
  userId as user_id,
  anonymousId as anonymous_id
FROM
  experiment_viewed
```

6. Then, define an assignment query for logged-in users:
   - Identifier type: `user_id`
   - SQL:
   ```sql
   SELECT
     userId as user_id,
     timestamp as timestamp,
     experimentId as experiment_id,
     variationId as variation_id,
     browser,
     country
   FROM
     experiment_viewed
   ```
   - Dimension columns: `browser`, `country`
7. And another assignment query for anonymous visitors:
   - Identifier type: `anonymous_id`
   - SQL:
   ```sql
   SELECT
     anonymousId as anonymous_id,
     timestamp as timestamp,
     experimentId as experiment_id,
     variationId as variation_id,
     browser,
     country
   FROM
     experiment_viewed
   ```
   - Dimension columns: `browser`, `country`
8. Create a metric:
   - Name: `Purchased`
   - Type: `binomial`
   - Identifier Types: Both `user_id` and `anonymous_id`
   - SQL:
   ```sql
   SELECT
     userId as user_id,
     anonymousId as anonymous_id,
     timestamp as timestamp
   FROM
     orders
   ```
9. Go to add an experiment. You should see a few that are ready to be imported from the data source.

There are a lot more metrics you can define with the sample data besides just "Purchased". Here are a few ideas:

- Revenue per User
- Average Order Value
- Page Views per User
- Retention Rate
- Session Duration
- Pages per Session
- Sessions with Searches
