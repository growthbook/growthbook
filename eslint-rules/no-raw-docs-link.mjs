// Matches the docs origin in any string, including inside a template literal
// chunk (e.g. `https://docs.growthbook.io/lib/${language}`).
const DOCS_HOST_REGEX = /docs\.growthbook\.io/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hard-coded docs.growthbook.io URLs in the front-end and shared packages; use the DocLink component instead.",
    },
    schema: [],
    messages: {
      noRawDocsLink:
        'Do not hard-code a docs.growthbook.io URL. Use `<DocLink docSection="...">` for links, or `docUrl("...")` when a component needs a plain URL string, from `@/components/DocLink`. DocLink centralises every docs URL in its `docSections` registry (so a moved docs page is one edit), type-checks the section key with a `fallBackSection` so a bad key can never render a broken link, and opens the link safely with `target="_blank"` and `rel="noopener noreferrer"`. In `packages/shared`, which cannot import front-end code, have the front-end caller pass the URL in instead.',
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value !== "string") return;
      if (!DOCS_HOST_REGEX.test(value)) return;

      context.report({ node, messageId: "noRawDocsLink" });
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
