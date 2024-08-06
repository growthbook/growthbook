// region Audit

/**
 * You can get this property on the response.locals.eventAudit property
 */
export type EventUser = EventUserLoggedIn | EventUserApiKey | null;

/**
 * You can get this property on the response.locals.eventAudit property.
 * Example usage:
 *    (req, res: Response<MyResponseData, EventUserForResponseLocals>) => {}
 */
export type EventUserForResponseLocals = {
  eventAudit: EventUser;
};

export type EventUserLoggedIn = {
  type: "dashboard";
  id: string;
  email: string;
  name: string;
};

export type EventUserApiKey = {
  type: "api_key";
  apiKey: string;
};

// endregion Audit

// region user.login

export type UserLoginAuditableProperties = {
  id: string;
  email: string;
  name: string;
  device: string;
  userAgent: string;
  ip: string;
  os: string;
};

// endregion user.login
