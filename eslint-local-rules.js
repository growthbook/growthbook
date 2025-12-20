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
          const filename = context.getFilename();

          // Check if it's importing from shared/src
          if (
            typeof importPath === "string" &&
            importPath.startsWith("shared/src/")
          ) {
            // If the file is within packages/shared/src, check if it's importing from the same subdirectory
            const fileInSharedMatch = filename.match(
              /\/packages\/shared\/src\/([^/]+)\//,
            );
            const importSubdirMatch = importPath.match(/^shared\/src\/([^/]+)/);

            if (fileInSharedMatch && importSubdirMatch) {
              const fileSubdir = fileInSharedMatch[1];
              const importSubdir = importSubdirMatch[1];

              // If importing from the same subdirectory, require relative imports
              if (fileSubdir === importSubdir) {
                // Calculate relative path
                // e.g., importPath: "shared/src/settings/resolvers/genDefaultResolver"
                // Extract the part after "shared/src/settings/"
                const importPathParts = importPath.split("/");
                const relativeParts = importPathParts.slice(3); // ["resolvers", "genDefaultResolver"]
                const relativeImport = "./" + relativeParts.join("/");

                context.report({
                  node: node.source,
                  message:
                    "Use relative imports (e.g., './file-name') when importing from other files within the same directory to avoid circular dependencies",
                  fix(fixer) {
                    const quote = node.source.raw[0];
                    return fixer.replaceText(
                      node.source,
                      `${quote}${relativeImport}${quote}`,
                    );
                  },
                });
                return;
              }
            }

            // If file is outside packages/shared, enforce entry point usage
            if (!filename.includes("/packages/shared/")) {
              const entryPoint = importSubdirMatch[1];
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
