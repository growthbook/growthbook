const fs = require("fs");
const path = require("path");
const stringify = require("json-stringify-pretty-compact");
const cases = require("../test/cases.json");

/**
 * Run `yarn type-safe-tests` from this package.
 * Example usage:
 *    yarn type-safe-tests && cat scripts/test-cases--typed.json | pbcopy
 * Outputs the file to ./test-cases--typed.json
 * ref: https://gist.github.com/jdorn/8f20940320b38dc7362ece284faaa40a
 */

const { specVersion, feature, run, ...otherFields } = cases;

const newCases = {
  specVersion,
  evalFeature: [],
  run: [],
  ...otherFields,
};

feature.forEach((testCase) => {
  const [name, context, feature, result] = testCase;
  const { attributes, features, forcedVariations } = context;
  const { on, off, source, value, experiment, experimentResult } = result;

  let type = typeof value;
  if (value === null) {
    type = "null";
  } else if (type === "string") {
    type = "string";
  } else if (type === "number") {
    type = "integer";
  } else if (type === "boolean") {
    type = "boolean";
  } else {
    console.log("Unknown", type, value);
    return;
  }

  newCases.evalFeature.push({
    name,
    type,
    context: {
      features: JSON.stringify(features || {}),
      attributes: JSON.stringify(attributes || null),
      forcedVariations: forcedVariations || null,
    },
    feature,
    result: JSON.stringify({
      on,
      off,
      source,
      value,
      experiment: experiment || null,
      experimentResult: experimentResult || null,
    }),
  });
});

run.forEach((testCase) => {
  const [name, context, experiment, variationId, inExperiment, hashUsed] =
    testCase;
  const { attributes, enabled, forcedVariations, qaMode, url } = context;

  const value = experiment.variations?.[0];
  let type = typeof value;
  if (value === null) {
    type = "null";
  } else if (type === "string") {
    type = "string";
  } else if (type === "number") {
    type = "integer";
  } else if (type === "boolean") {
    type = "boolean";
  } else if (type === "object" && value.color && value.size) {
    type = "obj_color_size";
  } else {
    console.log("Unknown", type, value);
    return;
  }

  newCases.run.push({
    name,
    type: typeof experiment.variations?.[0] === "number" ? "integer" : "string",
    context: {
      attributes: JSON.stringify(attributes || null),
      enabled: enabled ?? null,
      forcedVariations: forcedVariations ?? null,
      qaMode: qaMode ?? null,
      url: url ?? null,
    },
    experiment: JSON.stringify(experiment),
    result: {
      value: variationId,
      inExperiment,
      hashUsed,
    },
  });
});

fs.writeFileSync(
  path.join(__dirname, "test-cases--typed.json"),
  stringify(newCases, null, 2),
);
