import { z } from "zod";
import { OpenApiModelSpec } from "../api-model";
import {
  apiListPopulationSnapshotsValidator,
  apiPopulationSnapshotValidator,
} from "./population-snapshot";

/** REST API surface for Population Snapshots under `/api/v1/population-snapshots/*`. */
export const populationSnapshotApiSpec = {
  modelSingular: "populationSnapshot",
  modelPlural: "populationSnapshots",
  pathBase: "/population-snapshots",
  apiInterface: apiPopulationSnapshotValidator,
  schemas: {
    createBody: z.object({}),
    updateBody: z.object({}),
  },
  includeDefaultCrud: false,
  crudActions: ["list", "get"],
  crudValidatorOverrides: {
    list: apiListPopulationSnapshotsValidator,
  },
  crudDescriptions: {
    list: "With a date range, returns the last successful snapshot of each day, oldest first.",
  },
  navDisplayName: "Population Snapshots",
  navDescription:
    "A Population Snapshot records a population's size at a point in time.",
  navAfterTag: "Populations",
} as const satisfies OpenApiModelSpec;
export default populationSnapshotApiSpec;
