import fs from "node:fs";
import path from "node:path";

// Wraps a fixable rule so that, in files where eslint-suppressions.json still
// suppresses it, its autofix is offered as an editor suggestion instead.
// `eslint --fix` (and the lint-staged pre-commit hook) never applies
// suggestions, so touching a file no longer rewrites its suppressed
// violations; developers can still apply them one by one from the editor.
export function suggestFixInSuppressedFiles(rule, ruleId, rootDir) {
  const suppressions = JSON.parse(
    fs.readFileSync(path.join(rootDir, "eslint-suppressions.json"), "utf8"),
  );
  const suppressedFiles = new Set(
    Object.keys(suppressions).filter((file) => suppressions[file][ruleId]),
  );

  return {
    ...rule,
    meta: { ...rule.meta, hasSuggestions: true },
    create(context) {
      const file = path
        .relative(rootDir, context.filename)
        .split(path.sep)
        .join("/");
      if (!suppressedFiles.has(file)) return rule.create(context);

      const report = (descriptor) => {
        const { fix, ...rest } = descriptor;
        context.report(
          fix ? { ...rest, suggest: [{ desc: "Apply the fix.", fix }] } : rest,
        );
      };
      // The context is frozen, so a Proxy over it can't swap `report`.
      const proxied = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "report") return report;
            const value = Reflect.get(context, prop);
            return typeof value === "function" ? value.bind(context) : value;
          },
        },
      );
      return rule.create(proxied);
    },
  };
}
