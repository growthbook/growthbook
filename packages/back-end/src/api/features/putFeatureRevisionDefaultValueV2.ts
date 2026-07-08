import { putFeatureRevisionDefaultValueV2Validator } from "shared/validators";
import { setConfigBacking } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { setRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";
import {
  assertValidDefaultValueConfigKey,
  assertNoRawConfigExtends,
} from "./v2Shared";

export const putFeatureRevisionDefaultValueV2 = createApiRequestHandler(
  putFeatureRevisionDefaultValueV2Validator,
)(async (req) => {
  const { defaultValueConfig, defaultValue } = req.body;

  // Config backing comes only through `defaultValueConfig` — never a raw
  // `@config:` in the value. When set, `defaultValue` is an override patch we
  // recompose into the internal `$extends`-first value; `null` detaches it.
  assertNoRawConfigExtends(defaultValue, "defaultValue");
  let composedDefaultValue = defaultValue;
  if (defaultValueConfig !== undefined) {
    if (defaultValueConfig !== null) {
      await assertValidDefaultValueConfigKey(req.context, defaultValueConfig);
    }
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
