import { MigrationHandler } from "@back-end/src/migrations";

export const apply = (h: MigrationHandler) =>
  h.updateAll(h.collection, { organizationId: null }, ({ organizationId }) => ({
    organization: organizationId,
    organizationId: null,
  }));
