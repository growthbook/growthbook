export const featureSnapshot = {
  id: "id",
  organization: "org",
  owner: "owner",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  valueType: "string" as const,
  defaultValue: "defaultValue",
  version: 1,
  description: "description",
  project: "project",
  archived: true,
  tags: ["tag"],
  environmentSettings: {
    dev: { defaultValue: "defaultValue", enabled: false, rules: [] },
    production: { defaultValue: "defaultValue", enabled: false, rules: [] },
  },
};
