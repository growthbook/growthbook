module.exports = function (plop) {
  // region Back-end

  plop.setGenerator("router", {
    description: "[back-end] Generates a router and controller",
    prompts: [
      {
        type: "input",
        name: "resource",
        message:
          "What is the name of the resource? Use the singular form, e.g. event for API GET /event",
      },
    ],
    actions: [
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/routers/{{kebabCase resource}}/{{kebabCase resource}}.router.ts",
        templateFile: "./plop-templates/back-end/router.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/routers/{{kebabCase resource}}/{{kebabCase resource}}.controller.ts",
        templateFile: "./plop-templates/back-end/controller.hbs",
      },
    ],
  });

  // endregion Back-end

  // region Front-end

  plop.setGenerator("component", {
    description: "[front-end] Generates a component",
    prompts: [
      {
        type: "input",
        name: "component",
        message: "What should the name of the component be?",
      },
    ],
    actions: [
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/front-end/components/{{pascalCase component}}/{{pascalCase component}}.tsx",
        templateFile: "./plop-templates/front-end/component.hbs",
      },
    ],
  });

  plop.setGenerator("api-object", {
    description: "[back-end] Generate REST API list and get endpoints",
    prompts: [
      {
        type: "input",
        name: "object",
        message:
          "The singular name of the API object (e.g. 'metric' or 'data source')",
      },
    ],
    actions: [
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/api/{{kebabCase object}}s/{{kebabCase object}}s.router.ts",
        templateFile: "./plop-templates/back-end/api/router.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/api/{{kebabCase object}}s/list{{pascalCase object}}s.ts",
        templateFile: "./plop-templates/back-end/api/list.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/api/{{kebabCase object}}s/get{{pascalCase object}}.ts",
        templateFile: "./plop-templates/back-end/api/get.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/api/{{kebabCase object}}s/post{{pascalCase object}}.ts",
        templateFile: "./plop-templates/back-end/api/post.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/api/{{kebabCase object}}s/update{{pascalCase object}}.ts",
        templateFile: "./plop-templates/back-end/api/update.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/back-end/src/api/{{kebabCase object}}s/delete{{pascalCase object}}.ts",
        templateFile: "./plop-templates/back-end/api/delete.hbs",
      },
    ],
  });

  plop.setGenerator("next-page", {
    description: "[front-end] Generates a Next.js page",
    prompts: [
      {
        type: "input",
        name: "route",
        message:
          "What is the path this should live? e.g. settings/webhooks/[eventwebhookid] if you want to create the file settings/webhooks/[eventwebhookid].tsx",
      },
      {
        type: "input",
        name: "pageName",
        message:
          "What is the name of this page? This is used internally in the file and will have a `Page` suffix, e.g. EventWebHookDetail will be EventWebHookDetailPage",
      },
    ],
    actions: [
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/front-end/pages/{{route}}.tsx",
        templateFile: "./plop-templates/front-end/next-page.hbs",
      },
    ],
  });

  // endregion Front-end

  // region Shared

  plop.setGenerator("shared-entrypoint", {
    description: "[shared] Generates a new entry point for the shared package",
    prompts: [
      {
        type: "input",
        name: "entrypoint",
        message:
          "A new entry point for the shared package, e.g. 'todos' to make import { createTodo } from 'shared/todos'",
      },
      {
        type: "input",
        name: "function",
        message:
          "Name of the first function to add to this file, e.g. 'createTodo' to make import { createTodo } from 'shared/todos'",
      },
    ],
    actions: [
      // definition file
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/shared/{{kebabCase entrypoint}}.d.ts",
        template: `export * from "./src/{{kebabCase entrypoint}}";`.trim(),
      },
      // utils
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/shared/src/{{kebabCase entrypoint}}/{{kebabCase entrypoint}}.ts",
        template: `export function {{function}}(): void {
  // todo
}`.trim(),
      },
      // exports & barrel files
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/shared/{{kebabCase entrypoint}}.js",
        template:
          `module.exports = require("./dist/{{kebabCase entrypoint}}");`.trim(),
      },
      {
        type: "add",
        skipIfExists: true,
        path: "./packages/shared/src/{{kebabCase entrypoint}}/index.ts",
        template: `export * from "./{{kebabCase entrypoint}}";`.trim(),
      },
      {
        type: "append",
        path: "./packages/shared/src/index.ts",
        template:
          `export * as {{camelCase entrypoint}} from "./{{kebabCase entrypoint}}";`.trim(),
      },
    ],
  });

  // endregion Shared
};
