import { ApiReqContext } from "back-end/types/api";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { BadRequestError } from "back-end/src/util/errors";

// Hook execution is disabled on Cloud (the isolated-vm sandbox is self-hosted
// only), so management routes are too — mirrors the internal controller.
export function assertCustomHooksAvailable(context: ApiReqContext): void {
  if (IS_CLOUD) {
    throw new BadRequestError(
      "Custom hooks are not available on GrowthBook Cloud",
    );
  }
  if (!context.hasPremiumFeature("custom-hooks")) {
    context.throwPlanDoesNotAllowError(
      "Custom hooks require an enterprise plan",
    );
  }
}
