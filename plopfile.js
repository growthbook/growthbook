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
