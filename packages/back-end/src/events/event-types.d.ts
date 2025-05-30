// region Audit

/**
 * You can get this property on the response.locals.eventAudit property
 */
import { EventUser } from "back-end/src/validators/events";
export {
  EventUser,
  EventUserLoggedIn,
  EventUserApiKey,
} from "back-end/src/validators/events";

/**
 * You can get this property on the response.locals.eventAudit property.
 * Example usage:
 *    (req, res: Response<MyResponseData, EventUserForResponseLocals>) => {}
 */
export type EventUserForResponseLocals = {
  eventAudit: EventUser;
};

// endregion Audit

// region user.login

export type UserLoginEventProperties = {
  id: string;
  email: string;
  name: string;
  device: string;
  userAgent: string;
  ip: string;
  os: string;
};

// endregion user.login
