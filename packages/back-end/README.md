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

All back-end code for commercial features should live under the `src/enterprise` directory. The front-end and shared packages have their own `enterprise` directories as well which can be used as needed.

You will also need to edit `packages/shared/src/enterprise/license.ts`. Add to the `CommercialFeature` union type and edit the `accountFeatures` map, which defines which plans have access to which features

## Data Model Classes

This is the preferred way to create data models that sit on top of MongoDB collections.

### Example

Everything starts from a single Zod schema, representing the whole object:

```ts
// File: back-end/src/validators/foo.ts
import { z } from "zod";

export fooSchema = z.object({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  name: z.string(),
  // Use default() for properties that are optional when creating
  projects: z.array(z.string()).default([])
}).strict();
```

From this, you can export types to use throughout the front-end and back-end. These types are especially useful on the front-end to ensure full stack type safety.

```ts
// File: back-end/types/foo.d.ts
import { z } from "zod";
import type { fooSchema } from "shared/src/validators/foo";
import { CreateProps, UpdateProps } from "shared/types/base-model";

// Full interface
export type FooInterface = z.infer<fooSchema>;

// Helper types for the subset of fields that can be set when creating/updating
// For example, you can't update 'id' after it's been created
export type CreateFooProps = CreateProps<FooInterface>;
export type UpdateFooProps = UpdateProps<FooInterface>;
```

Create the data model class based on the schema.

```ts
// File: back-end/src/models/FooModel.ts
import { fooSchema } from "shared/src/validators/foo";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: fooValidator,
  collectionName: "foos",
  idPrefix: "foo_",
  // You may need to add these to `back-end/src/types/Audit.ts` too
  auditLog: {
    entity: "foo",
    createEvent: "foo.create",
    updateEvent: "foo.update",
    deleteEvent: "foo.delete",
  },
  // If true, `id` is globally unique across all orgs
  // If false (default), the `organization`/`id` combo is unique.
  globallyUniqueIds: false,
  readonlyFields: [],
});

export class FooDataModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: FooInterface): boolean {
    return this.context.permissions.canCreateFoo(doc);
  }
  protected canRead(doc: FooInterface): boolean {
    return this.context.permissions.canReadFoo(doc);
  }
  protected canUpdate(
    existing: FooInterface,
    updates: UpdateProps<FooInterface>,
  ): boolean {
    return this.context.permissions.canUpdateFoo(existing, updates);
  }
  protected canDelete(doc: FooInterface): boolean {
    return this.context.permissions.canDeleteFoo(doc);
  }
}
```

And lastly, add it to the Request Context class:

```ts
// File: back-end/src/services/context.ts
export class ReqContextClass {
  public models!: {
    // ...
    foos: FooDataModel;
  };
  private initModels() {
    this.models = {
      // ...
      foos: new FooDataModel(this),
    };
  }
  // ...
}
```

Now you can access it anywhere you have context and use the built-in methods:

```ts
const foo = await context.models.foos.getById("foo_123");
if (!foo) throw new Error("Could not find foo");

console.log("Old Name: ", foo.name);

const newFoo = await context.models.foos.update(foo, { name: "New Name" });
console.log("New Name: ", newFoo.name);
```

### Built-in Public Methods

The following public methods are created automatically:

- `getAll()`
- `getById(id)`
- `getByIds(ids)`
- `create(data)`
- `update(existing, changes)`
- `updateById(id, changes)`
- `delete(existing)`
- `deleteById(id)`

The `create`, `update`, and `updateById` methods accept either strongly typed arguments or `unknown`. Everything is validated before saving, so this is safe. This is useful when you want to pass in `req.body` directly without manually doing validation.

### Custom Methods

You can add more tailored data fetching methods as needed by referencing the `_findOne` and `_find` methods. There are similar protected methods for write operations, although those are rarely needed.

Here's an example:

```ts
export class FooDataModel extends BaseClass {
  // ...

  public getByNames(names: string[]) {
    return this._find({ name: { $in: names } });
  }
}
```

Note: Permission checks, migrations, etc. are all done automatically within the `_find` method, so you don't need to repeat any of that in your custom methods. Also, the `organization` field is automatically added to every query, so it will always be multi-tenant safe.

### Hooks

The following hooks are available, letting you add additional validation or perform trigger-like behavior without messing with data model internals. All of these besides `migrate` are async. Define these in your child class and they will be called at appropriate times.

- `migrate(legacyObj): newObj`
- `customValidation(obj)` (called for both update/create flows)
- `beforeCreate(newObj)`
- `afterCreate(newObj)`
- `beforeUpdate(existing, updates, newObj)`
- `afterUpdate(existing, updates, newObj)`
- `afterCreateOrUpdate(newObj)`
- `beforeDelete(existing)`
- `afterDelete(existing)`

Here's an example:

```ts
export class FooDataModel extends BaseClass {
  // ...

  protected async beforeDelete(existing: FooInterface) {
    const barsUsingFoo = await getAllBarsUsingFoo(this.context, existing.id);
    if (bars.length > 0) {
      throw new Error("Cannot delete. One or more bars is linking to this foo");
    }
  }
}
```

The order of hooks for create/update operations is as follows:

1. customValidation
2. beforeCreate
3. afterCreate
4. afterCreateOrUpdate

### Foreign Keys

It's common for data models to reference other models. For example, a `metric` references a `data source`. There is a helper function `getForeignRefs` you can call from any of the hooks above.

Here's an example where a metric is using its data source for more advanced validation.

```ts
export class FactMetricModel extends BaseClass {
  // ...
  protected async customValidation(doc: FooInterface) {
    if (doc.metricType === "quantile") {
      const { datasource } = this.getForeignRefs(doc);

      if (datasource?.type === "mysql") {
        throw new Error("MySQL does not support quantile metrics");
      }
    }
  }
}
```

Foreign keys to experiments and data sources are detected automatically. This works as long as you use standard naming for fields (e.g. `datasource` or `datasourceId`).

Other types of foreign keys can be easily added to the base model if needed.

The `getForeignRefs` method has an optional second parameter. If `true` (the default), it will throw an Error if a foreign ref is not found. You can pass `false` instead to have it just skip that foreign ref instead.

### Conditional validation/hooks

Sometimes you need more control over your validation or hooks. For example, if you want to run really strict validation by default, but allow users to opt-out.

This is accomplished with "Write Options". Pass this as a type hint into your BaseClass and it will be accepted as an extra argument to all write methods (create, update, delete) and will be forwarded along to all of your hooks.

```ts
// All properties MUST be optional. An empty object is the default value.
type WriteOptions = {
  skipTestQuery?: boolean;
};

export class FactMetricModel extends BaseClass<WriteOptions> {
  // ...
  protected async customValidation(doc, writeOptions) {
    if (!writeOptions.skipTestQuery) {
      // Run a test query against the data warehouse to make sure it works
    }
  }
}
```

Now, this can be specified whenever calling create, update, or delete methods.

```ts
await context.models.factMetrics.updateById(
  id,
  { name: "New Name" },
  { skipTestQuery: true },
);
```

## Tests

We use Jest to write tests on the back-end.

To avoid pulling in Mongo dependencies, all tested code should be in small standalone util files that do not import db models.

## REST API endpoints

We use OpenAPI to document our REST endpoints.

Let's say you want to add a REST endpoint to get a list of projects.

### OpenAPI Spec

First, you would document the endpoint using OpenAPI:

1. Describe the resource (Project) with a JSON schema: `src/api/openapi/schemas/Project.yaml`
   ```yml
   type: object
   required:
     - id
     - name
   properties:
     id:
       type: string
     name:
       type: string
   ```
2. Reference your schema in `src/api/openapi/schemas/_index.yaml`
   ```yml
   Project:
     $ref: "./Project.yaml"
   ```
3. Describe the API endpoint in `src/api/openapi/paths/listProjects.yaml`
   ```yml
   get:
     summary: Get all projects
     tags:
       - projects
     parameters:
       - $ref: "../parameters.yaml#/limit"
       - $ref: "../parameters.yaml#/offset"
     operationId: listProjects
     x-codeSamples:
       - lang: "cURL"
         source: |
           curl https://api.growthbook.io/api/v1/projects \
             -u secret_abc123DEF456:
     responses:
       "200":
         content:
           application/json:
             schema:
               allOf:
                 - type: object
                   required:
                     - projects
                   properties:
                     projects:
                       type: array
                       items:
                         $ref: "../schemas/Project.yaml"
                 - $ref: "../schemas/PaginationFields.yaml"
   ```
4. Add the endpoint to `src/api/openapi/openapi.yaml` under `paths`
   ```yml
   /projects:
     $ref: "./paths/listProjects.yaml"
   ```
5. In the same `src/api/openapi/openapi.yaml` file, define the `projects` tag:
   ```yml
   - name: projects
     x-displayName: Projects
     description: Projects are used to organize your feature flags and experiments
   ```

We use a generator to automatically create Typescript types, Zod validators, and API documentation for all of our resources and endpoints. Any time you edit the `yaml` files, you will need to re-run this generator.

```bash
yarn generate-api-types
```

### Router and Business Logic

Next, you'll need to create a helper function to convert from our internal DB interface to the API interface:

```ts
// src/models/ProjectModel.ts
import { ApiProject } from "back-end/types/openapi";
import { ProjectInterface } from "back-end/types/project";

export class ProjectModel extends BaseClass {
  ...

  public toApiInterface(project: ProjectInterface): ApiProject {
    return {
      id: project.id,
      name: project.name,
    };
  }
}
```

Then, create a route for your endpoint at `src/api/projects/listProjects.ts`:

```ts
import { ListProjectsResponse } from "back-end/types/openapi";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listProjectsValidator } from "back-end/src/validators/openapi";

export const listProjects = createApiRequestHandler(listProjectsValidator)(
  async (req): Promise<ListProjectsResponse> => {
    const projects = await req.context.models.projects.getAll();
    const { filtered, returnFields } = applyPagination(
      projects.sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );
    return {
      projects: filtered.map((project) =>
        req.context.models.projects.toApiInterface(project),
      ),
      ...returnFields,
    };
  },
);
```

Then, create a router at `src/api/projects/projects.router.ts`:

```ts
import { Router } from "express";
import { listProjects } from "./listProjects";

const router = Router();

// Project Endpoints
// Mounted at /api/v1/projects
router.get("/", listProjects);

export default router;
```

Finally, mount your router in `src/api/api.router.ts`:

```ts
import projectsRouter from "./projects/projects.router";
// ...

router.use("/projects", projectsRouter);
```

That's it! Your API endpoint is live and ready and all the documentation will be auto-generated for you.

### Automating with Plop

We have a Plop script to automate many of the above steps for you.

```bash
yarn plop
```

Then, select `api-object` from the list and enter the name of your resource (`project` in this case).

You'll still have to go through all the steps above and make tweaks as needed, but most of the code will be auto-generated for you.

## Sample Data

### Creating sample data

To use the analysis parts of GrowthBook, you need to connect to a data source with experimentation events.

We have a sample data generator script you can use to seed a database with realistic website traffic:

1. Run `yarn workspace back-end generate-dummy-data`. This will create CSV files in `/tmp/csv`
2. Start your local server (e.g. Postgres, MySQL) or ensure your cloud service (e.g. Snowflake, BigQuery) is set up
3. Connect to your database instance and run the SQL commands matching your server type in `packages/back-end/test/data-generator/sql_scripts/` to create the tables and upload the generated data

We have SQL scripts set up to work with Postgres, MySQL, and Snowflake, but you could modify the SQL scripts to work with another system.

WARNING: the purchases.csv file contains `'\N'` to represent null values which may need to be handled differently depending on the DB engine you are using. It works with both the provided scripts discussed below.

**Postgres**

For postgres, launch your connection using `psql` and run this script `packages/back-end/test/data-generator/sql_scripts/create_postgres.sql` to create the tables and upload the csvs.

You can do this from your terminal with the following command, if your local postgres db is running with user `postgres`, database `growthbook_db`,

```bash
psql -U postgres -d growthbook_db -a -f packages/back-end/test/data-generator/sql_scripts/create_postgres.sql
```

**MySQL**

Once your local MySQL db is running, you have to ensure that your server allows for local infiles. You can do this in your MySQL config file or by connecting to your instance using `mysql` and running `set global local_infile = true;` in the mysql console.

Then, you can run `packages/back-end/test/data-generator/sql_scripts/create_mysql.sql` from the mysql console or from the terminal like so (using example user `myuser` and example database `growthbook_db`):

```bash
mysql -u myuser -p growthbook_db --local-infile < packages/back-end/test/data-generator/sql_scripts/create_mysql.sql
```

**Snowflake**

Create a database and a schema in your Snowflake. Then, you can run `packages/back-end/test/data-generator/sql_scripts/create_snowflake.sql` using the `snowsql` command line client (see their [docs](https://docs.snowflake.com/en/user-guide/snowsql.html)). For example, you can run the following in your Mac or Linux terminal if you have a database called `growthbook_db`, a schema called `sample`, account name called `account-name`, and you want to use user `myuser` to log in.

```bash
snowsql -d growthbook_db -s sample -a account-name -u myuser -f packages/back-end/test/data-generator/sql_scripts/create_snowflake.sql
```

Note if you're on a windows machine, you will have to modify `create_snowflake.sql` to point to the files different (see the Snowflake docs [here](https://docs.snowflake.com/en/user-guide/data-load-internal-tutorial-stage-data-files.html).)

**BigQuery**

We don't include a SQL script for BigQuery, but you can easily upload data by running the following kind of command for each csv file from your terminal, if you have set up the `bq` command line tool:

```bash
bq load --project_id=my-teams-project --skip_leading_rows=1 --source_format=CSV --null_marker="\N" sample.orders /tmp/csv/purchases.csv userId:STRING,anonymousId:STRING,sessionId:STRING,browser:STRING,country:STRING,timestamp:TIMESTAMP,qty:INTEGER,amount:INTEGER
```

where `my-teams-project` is your BQ project, you have created the dataset `sample`, and want to load `purchases.csv` in to the `orders` table in that dataset.

### Loading sample data in to Growthbook

Next, you'll need to set up the connection to your DB from within GrowthBook.

1. Under Analysis->Data Sources, add a new data source
2. Select "Custom Event Source"
3. Select your server type (e.g. Postgres, MySQL) and enter your connection info. If you are running with `yarn dev`, you can use `localhost` safely and ignore the warning in the UI about docker.
4. On the data source page, you can add two identifier types: `user_id` and `anonymous_id`
5. Add an Identifier Join table:

```sql
SELECT
  user_id,
  anonymous_id
FROM
  viewed_experiment
```

6. Then, define an assignment query for logged-in users:
   - Identifier type: `user_id`
   - SQL:

   ```sql
   SELECT
     user_id,
     timestamp as timestamp,
     experiment_id,
     variation_id,
     browser,
     country
   FROM
     viewed_experiment
   ```

   - Dimension columns: `browser`, `country`

7. And another assignment query for anonymous visitors:
   - Identifier type: `anonymous_id`
   - SQL:

   ```sql
   SELECT
     anonymous_id,
     timestamp as timestamp,
     experiment_id as experiment_id,
     variation_id as variation_id,
     browser,
     country
   FROM
     viewed_experiment
   ```

   - Dimension columns: `browser`, `country`

8. Create a metric:
   - Name: `Purchased`
   - Type: `binomial`
   - Identifier Types: Both `user_id` and `anonymous_id`
   - SQL:
   ```sql
   SELECT
     user_id,
     anonymous_id,
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
