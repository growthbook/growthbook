module.exports = function (plop) {
  plop.setGenerator("component", {
    description: "Generates a component and a Storybook story",
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
          "./components/{{pascalCase component}}/{{pascalCase component}}.tsx",
        templateFile: "./plop-templates/component.hbs",
      },
      {
        type: "add",
        skipIfExists: true,
        path:
          "./components/{{pascalCase component}}/{{pascalCase component}}.stories.tsx",
        templateFile: "./plop-templates/component-story.hbs",
      },
    ],
  });
};
