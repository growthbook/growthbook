import { putFeatureRevisionDefaultValueV2Validator } from "shared/validators";
import { setConfigBacking } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { BadRequestError } from "back-end/src/util/errors";
import { setRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";

export const putFeatureRevisionDefaultValueV2 = createApiRequestHandler(
  putFeatureRevisionDefaultValueV2Validator,
)(async (req) => {
  const { config, defaultValue } = req.body;

  // When `config` is supplied, `defaultValue` is an override patch; recompose
  // it into the internal `$extends`-first value. `null` detaches any config.
  let composedDefaultValue = defaultValue;
  if (config !== undefined) {
    composedDefaultValue = setConfigBacking(config, defaultValue);
    if (config !== null) {
      const feature = await getFeature(req.context, req.params.id);
      if (feature?.jsonSchema?.enabled) {
        throw new BadRequestError(
          "Cannot back the default value with a config while the flag defines its own JSON schema. The config's schema is authoritative — remove the flag's jsonSchema first.",
        );
      }
    }
  }

  const { revision } = await setRevisionDefaultValue(
    req.context,
    req.organization,
    req.params,
    { ...req.body, defaultValue: composedDefaultValue },
  );
  return { revision: toApiRevisionV2(revision) };
});
