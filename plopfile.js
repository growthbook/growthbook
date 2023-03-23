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
        path:
          "./packages/back-end/src/routers/{{kebabCase resource}}/{{kebabCase resource}}.router.ts",
        templateFile: "./plop-templates/back-end/router.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/routers/{{kebabCase resource}}/{{kebabCase resource}}.controller.ts",
        templateFile: "./plop-templates/back-end/controller.hbs",
      },
    ],
  });

  // endregion Back-end

  // region Front-end

  plop.setGenerator("component", {
    description: "[front-end] Generates a component and a Storybook story",
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
        path:
          "./packages/front-end/components/{{pascalCase component}}/{{pascalCase component}}.tsx",
        templateFile: "./plop-templates/front-end/component.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/front-end/components/{{pascalCase component}}/{{pascalCase component}}.stories.tsx",
        templateFile: "./plop-templates/front-end/component-story.hbs",
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
        path:
          "./packages/back-end/src/api/{{kebabCase object}}s/{{kebabCase object}}s.router.ts",
        templateFile: "./plop-templates/back-end/api/router.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/{{kebabCase object}}s/list{{pascalCase object}}s.ts",
        templateFile: "./plop-templates/back-end/api/list.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/{{kebabCase object}}s/get{{pascalCase object}}.ts",
        templateFile: "./plop-templates/back-end/api/get.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/{{kebabCase object}}s/post{{pascalCase object}}.ts",
        templateFile: "./plop-templates/back-end/api/post.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/openapi/schemas/{{pascalCase object}}.yaml",
        templateFile: "./plop-templates/back-end/api/openapi_model.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/openapi/paths/list{{pascalCase object}}s.yaml",
        templateFile: "./plop-templates/back-end/api/openapi_list.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/openapi/paths/post{{pascalCase object}}.yaml",
        templateFile: "./plop-templates/back-end/api/openapi_post.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/openapi/paths/put{{pascalCase object}}.yaml",
        templateFile: "./plop-templates/back-end/api/openapi_put.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./packages/back-end/src/api/openapi/paths/get{{pascalCase object}}.yaml",
        templateFile: "./plop-templates/back-end/api/openapi_get.hbs",
      },
      {
        type: "append",
        path: "./packages/back-end/src/api/openapi/schemas/_index.yaml",
        template: `
{{pascalCase object}}:
  $ref: './{{pascalCase object}}.yaml'
`.trim(),
      },
      {
        type: "append",
        path: "./packages/back-end/src/api/openapi/openapi.yaml",
        pattern: /PLOP_INSERT_PATHS_HERE/,
        template: `  /{{kebabCase object}}s:
    get:
      $ref: "./paths/list{{pascalCase object}}s.yaml"
    post:
      $ref: "./paths/post{{pascalCase object}}.yaml"
  /{{kebabCase object}}s/{id}:
    get:
      $ref: "./paths/get{{pascalCase object}}.yaml"
    put:
      $ref: "./paths/put{{pascalCase object}}.yaml"`,
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
};
