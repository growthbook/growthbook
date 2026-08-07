const BANNED_VALUES = new Set(["freeFormQuery", "unknown", ""]);

const MESSAGE =
  'queryType "{{value}}" is not allowed here. ' +
  "`freeFormQuery` is reserved for user-provided SQL (services/datasource.ts); " +
  "`unknown`/empty is an internal fallback only. " +
  "Create a new specific QueryType in packages/shared/types/query.d.ts.";

function isBannedLiteral(node) {
  return (
    node.type === "Literal" &&
    typeof node.value === "string" &&
    BANNED_VALUES.has(node.value)
  );
}

function isQueryTypeKey(node) {
  if (node.computed) return false;
  if (node.key.type === "Identifier") return node.key.name === "queryType";
  if (node.key.type === "Literal") return node.key.value === "queryType";
  return false;
}

function isRunTestQueryCallee(node) {
  if (node.type === "Identifier") return node.name === "runTestQuery";
  if (node.type === "MemberExpression" && !node.computed) {
    return (
      node.property.type === "Identifier" &&
      node.property.name === "runTestQuery"
    );
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow reserved queryType literals on generated queries.",
    },
    schema: [],
    messages: {
      restrictedQueryType: MESSAGE,
    },
  },
  create(context) {
    return {
      Property(node) {
        if (!isQueryTypeKey(node)) return;
        if (!isBannedLiteral(node.value)) return;
        context.report({
          node: node.value,
          messageId: "restrictedQueryType",
          data: { value: node.value.value },
        });
      },
      CallExpression(node) {
        if (!isRunTestQueryCallee(node.callee)) return;
        const third = node.arguments[2];
        if (!third || !isBannedLiteral(third)) return;
        context.report({
          node: third,
          messageId: "restrictedQueryType",
          data: { value: third.value },
        });
      },
    };
  },
};
