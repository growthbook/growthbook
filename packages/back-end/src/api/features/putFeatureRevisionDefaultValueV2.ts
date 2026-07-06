import { putFeatureRevisionDefaultValueV2Validator } from "shared/validators";
import { setConfigBacking } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { setRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";
import { assertValidDefaultValueConfigKey } from "./v2Shared";

export const putFeatureRevisionDefaultValueV2 = createApiRequestHandler(
  putFeatureRevisionDefaultValueV2Validator,
)(async (req) => {
  const { config, defaultValue } = req.body;

  // When `config` is supplied, `defaultValue` is an override patch; recompose
  // it into the internal `$extends`-first value. `null` detaches any config.
  let composedDefaultValue = defaultValue;
  if (config !== undefined) {
    if (config !== null) {
      await assertValidDefaultValueConfigKey(req.context, config);
    }
    composedDefaultValue = setConfigBacking(config, defaultValue);
  }

  const { revision } = await setRevisionDefaultValue(
    req.context,
    req.organization,
    req.params,
    { ...req.body, defaultValue: composedDefaultValue },
  );
  return { revision: toApiRevisionV2(revision) };
});
