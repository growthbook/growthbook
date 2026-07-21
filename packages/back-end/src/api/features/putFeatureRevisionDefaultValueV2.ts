import { putFeatureRevisionDefaultValueV2Validator } from "shared/validators";
import { setConfigBacking } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { setRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";
import {
  assertValidDefaultValueConfig,
  assertNoRawConfigExtends,
} from "./v2Shared";

export const putFeatureRevisionDefaultValueV2 = createApiRequestHandler(
  putFeatureRevisionDefaultValueV2Validator,
)(async (req) => {
  const { defaultValueConfig, defaultValue } = req.body;

  // Config backing comes only through `defaultValueConfig` — never a raw
  // `@config:` in the value. When set, `defaultValue` is an override patch we
  // recompose into the internal `$extends`-first value; `null` detaches it.
  // The config must be within the feature's `baseConfig` family (same gate as
  // the create/update paths).
  assertNoRawConfigExtends(defaultValue, "defaultValue");
  let composedDefaultValue = defaultValue;
  if (defaultValueConfig !== undefined) {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error(`Feature "${req.params.id}" not found.`);
    }
    await assertValidDefaultValueConfig(
      req.context,
      feature.baseConfig,
      defaultValueConfig,
    );
    composedDefaultValue = setConfigBacking(defaultValueConfig, defaultValue);
  }

  const { revision } = await setRevisionDefaultValue(
    req.context,
    req.organization,
    req.params,
    { ...req.body, defaultValue: composedDefaultValue },
  );
  return { revision: toApiRevisionV2(revision) };
});
