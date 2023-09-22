import { z } from "zod";
import {
  createFactFilterPropsValidator,
  createFactPropsValidator,
  createFactTablePropsValidator,
  numberFormatValidator,
  updateFactFilterPropsValidator,
  updateFactPropsValidator,
  updateFactTablePropsValidator,
} from "../src/routers/fact-table/fact-table.validators";

export type FactNumberFormat = z.infer<typeof numberFormatValidator>;

export interface FactInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  column: string;
  numberFormat: FactNumberFormat;
  filters: string[];
}

export interface FactFilterInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  name: string;
  description: string;
  value: string;
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
  tags: string[];
  datasource: string;
  userIdTypes: string[];
  sql: string;
  facts: FactInterface[];
  filters: FactFilterInterface[];
}

export type CreateFactTableProps = z.infer<
  typeof createFactTablePropsValidator
>;
export type UpdateFactTableProps = z.infer<
  typeof updateFactTablePropsValidator
>;
export type CreateFactFilterProps = z.infer<
  typeof createFactFilterPropsValidator
>;
export type UpdateFactFilterProps = z.infer<
  typeof updateFactFilterPropsValidator
>;
export type UpdateFactProps = z.infer<typeof updateFactPropsValidator>;
export type CreateFactProps = z.infer<typeof createFactPropsValidator>;
