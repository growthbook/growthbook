import { z } from "zod";
import {
  createFactPropsValidator,
  createFactTablePropsValidator,
  factTypeValidator,
  numberFormatValidator,
  updateFactPropsValidator,
  updateFactTablePropsValidator,
} from "../src/routers/fact-table/fact-table.validators";

export type FactType = z.infer<typeof factTypeValidator>;

export type FactNumberFormat = z.infer<typeof numberFormatValidator>;

export interface FactInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  type: FactType;
  column: string;
  numberFormat: FactNumberFormat;
  where: string;
}

export interface FactTableInterface {
  organization: string;
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  owner: string;
  projects: string[];
  datasource: string;
  userIdTypes: string[];
  sql: string;
  facts: FactInterface[];
}

export type CreateFactTableProps = z.infer<
  typeof createFactTablePropsValidator
>;
export type UpdateFactTableProps = z.infer<
  typeof updateFactTablePropsValidator
>;
export type UpdateFactProps = z.infer<typeof updateFactPropsValidator>;
export type CreateFactProps = z.infer<typeof createFactPropsValidator>;
