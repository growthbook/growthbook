// Custom ESLint rules for GrowthBook
module.exports = {
  "no-internal-shared-imports": {
    meta: {
      type: "problem",
      docs: {
        description:
          "Enforce using entry points instead of internal shared paths",
        category: "Best Practices",
        recommended: true,
      },
      fixable: "code",
      messages: {
        useEntryPoint:
          'Import from entry point "{{suggestedPath}}" instead of "{{importPath}}"',
      },
      schema: [],
    },
    create(context) {
      return {
        ImportDeclaration(node) {
          const importPath = node.source.value;

          // Check if it's importing from shared/src
          if (
            typeof importPath === "string" &&
            importPath.startsWith("shared/src/")
          ) {
            // Extract the first directory after shared/src/
            // e.g., "shared/src/validators/foo" -> "validators"
            // e.g., "shared/src/enterprise/validators/bar" -> "enterprise"
            const match = importPath.match(/^shared\/src\/([^/]+)/);
            if (match) {
              const entryPoint = match[1];
              const suggestedPath = `shared/${entryPoint}`;

              context.report({
                node: node.source,
                messageId: "useEntryPoint",
                data: {
                  importPath: importPath,
                  suggestedPath: suggestedPath,
                },
                fix(fixer) {
                  // Replace the import path, keeping the quotes
                  const quote = node.source.raw[0];
                  return fixer.replaceText(
                    node.source,
                    `${quote}${suggestedPath}${quote}`,
                  );
                },
              });
            }
          }
        },
      };
    },
  },
};
