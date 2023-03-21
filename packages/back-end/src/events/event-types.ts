// region Audit user login events

export type AuditableUserProperties = {
  id: string;
  email: string;
  name: string;
  device: string;
  userAgent: string;
  ip: string;
  os: string;
};

// endregion Audit user login events
