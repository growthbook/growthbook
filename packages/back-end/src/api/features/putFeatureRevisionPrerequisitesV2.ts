import { putFeatureRevisionPrerequisitesV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { setRevisionPrerequisites } from "./putFeatureRevisionPrerequisites";

export const putFeatureRevisionPrerequisitesV2 = createApiRequestHandler(
  putFeatureRevisionPrerequisitesV2Validator,
)(async (req) => {
  // Validate each prerequisite references a boolean flag, then normalize the
  // condition to {"value":true}. The condition is not accepted from callers —
  // feature-level prerequisites are always "boolean flag is on" gates.
  const normalized = await Promise.all(
    req.body.prerequisites.map(async ({ id }) => {
      const prereqFeature = await getFeature(req.context, id);
      if (!prereqFeature) {
        throw new BadRequestError(`Prerequisite feature "${id}" not found`);
      }
      if (prereqFeature.valueType !== "boolean") {
        throw new BadRequestError(
          `Prerequisite feature "${id}" must be a boolean flag (got "${prereqFeature.valueType}"). Feature-level prerequisites only support boolean flags.`,
        );
      }
      return { id, condition: '{"value":true}' };
    }),
  );

  const { revision } = await setRevisionPrerequisites(
    req.context,
    req.organization,
    req.params,
    { ...req.body, prerequisites: normalized },
  );
  return { revision: toApiRevisionV2(revision) };
});
