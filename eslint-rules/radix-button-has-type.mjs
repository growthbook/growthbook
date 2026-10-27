const RADIX_BUTTONS = new Set(["Button", "IconButton"]);

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an explicit type on Radix Button and IconButton, which render a <button> with no default type.",
    },
    schema: [],
    messages: {
      missingType:
        'Radix `{{name}}` renders a <button> with no default type, so inside a form it submits the form. Add type="button" (or type="submit" if it should submit).',
    },
  },
  create(context) {
    const radixLocals = new Map();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@radix-ui/themes") return;
        for (const spec of node.specifiers) {
          if (
            spec.type === "ImportSpecifier" &&
            spec.imported.type === "Identifier" &&
            RADIX_BUTTONS.has(spec.imported.name)
          ) {
            radixLocals.set(spec.local.name, spec.imported.name);
          }
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const imported = radixLocals.get(node.name.name);
        if (!imported) return;
        const hasType = node.attributes.some(
          (attr) =>
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            attr.name.name === "type",
        );
        if (hasType) return;
        context.report({
          node,
          messageId: "missingType",
          data: { name: imported },
        });
      },
    };
  },
};
