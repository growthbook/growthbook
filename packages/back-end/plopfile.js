module.exports = function (plop) {
  plop.setGenerator("router", {
    description: "Generates a router and controller",
    prompts: [
      {
        type: "input",
        name: "resource",
        message:
          "What is the name of the resource? e.g. event for API GET /events",
      },
    ],
    actions: [
      {
        type: "add",
        skipIfExists: true,
        path:
          "./src/routers/{{kebabCase resource}}//{{kebabCase resource}}.router.ts",
        templateFile: "./plop-templates/router.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./src/routers/{{kebabCase resource}}//{{kebabCase resource}}.controller.ts",
        templateFile: "./plop-templates/controller.hbs",
      },
    ],
  });
};
