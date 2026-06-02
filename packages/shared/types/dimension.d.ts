import { z } from "zod";
import {
  dimensionSlicesResultValidator,
  dimensionSlicesValidator,
} from "../src/validators/dimensions";

export interface DimensionInterface {
  id: string;
  organization: string;
  managedBy?: "" | "api" | "config";
  owner: string;
  datasource: string;
  description?: string;
  userIdType: string;
  name: string;
  sql: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}

export type DimensionSlicesResult = z.infer<
  typeof dimensionSlicesResultValidator
>;

export type DimensionSlicesInterface = z.infer<typeof dimensionSlicesValidator>;
