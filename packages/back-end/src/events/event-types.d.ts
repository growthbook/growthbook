// region Audit

/**
 * You can get this property on the response.locals.eventAudit property
 */
export type EventAuditUser =
  | EventAuditUserLoggedIn
  | EventAuditUserApiKey
  | null;

/**
 * You can get this property on the response.locals.eventAudit property.
 * Example usage:
 *    (req, res: Response<MyResponseData, EventAuditUserForResponseLocals>) => {}
 */
export type EventAuditUserForResponseLocals = {
  eventAudit: EventAuditUser;
};

export type EventAuditUserLoggedIn = {
  type: "dashboard";
  id: string;
  email: string;
  name: string;
};

export type EventAuditUserApiKey = {
  type: "api_key";
  apiKey: string;
};

// endregion Audit
