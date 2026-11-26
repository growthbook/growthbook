const REST_API_PATH_REGEX = /^\/api\/v\d/;

function isRestApiPath(value) {
  return REST_API_PATH_REGEX.test(value);
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow public API (/api/v*) path literals; use the typed REST API helpers.",
    },
    schema: [],
    messages: {
      noRestApiPath:
        "Use useRestApi/useRestApiCall from @/services/restApi with a shared endpoint definition for GrowthBook REST API requests. For existing endpoints and migration steps, read .agents/guides/backend/how-to-migrate-endpoints-to-shared.md.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string" && isRestApiPath(node.value)) {
          context.report({ node, messageId: "noRestApiPath" });
        }
      },
      TemplateLiteral(node) {
        const head = node.quasis[0].value;
        if (isRestApiPath(head.cooked ?? head.raw)) {
          context.report({ node, messageId: "noRestApiPath" });
        }
      },
    };
  },
};
