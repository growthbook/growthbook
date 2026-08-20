const { createTransformer } = require("@swc/jest");

const swc = createTransformer();

// agenda@6 uses `import x from './file.json' with { type: 'json' }`, which
// @swc/core@1.3.4 cannot parse. Rewrite to CJS require before transforming.
const IMPORT_ATTR_JSON =
  /import\s+(\w+)\s+from\s+(['"])([^'"]+\.json)\2\s+with\s*\{\s*type:\s*['"]json['"]\s*\};?/g;

function stripImportAttributes(src) {
  return src.replace(
    IMPORT_ATTR_JSON,
    (_match, ident, _quote, spec) =>
      `const ${ident} = require(${JSON.stringify(spec)});`,
  );
}

module.exports = {
  process(src, filename, config, options) {
    return swc.process(stripImportAttributes(src), filename, config, options);
  },
  processAsync(src, filename, config, options) {
    return swc.processAsync(
      stripImportAttributes(src),
      filename,
      config,
      options,
    );
  },
  getCacheKey(src, filename, ...rest) {
    return swc.getCacheKey(stripImportAttributes(src), filename, ...rest);
  },
};
