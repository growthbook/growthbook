import { z } from "zod";
import { notificationEventNames } from "../../events/base-types";
import { logger } from "../../util/logger";
import { errorStringFromZodResult } from "../../util/validation";
import { PropertyValidator } from "./types";

export const validateNotificationEventNames: PropertyValidator = (value) => {
  const zodSchema = z.array(z.enum(notificationEventNames)).min(1);

  const result = zodSchema.safeParse(value);

  if (!result.success) {
    const errorString = errorStringFromZodResult(result);
    logger.error(errorString, "Invalid Event name");
  }

  return result.success;
};
