import { FormatOptions } from "sql-formatter";
import { Stripe } from "stripe";

// The data going out in an sdk payload to map from a saved group ID to its array of values
export type SavedGroupsValues = Record<string, (string | number)[]>;

export type GroupMap = Map<
  string,
  Pick<
    SavedGroupInterface,
    "type" | "condition" | "attributeKey" | "useEmptyListGroup"
  > & {
    values?: (string | number)[];
  }
>;

export interface SavedGroupInterface {
  id: string;
  organization: string;
  groupName: string;
  owner: string;
  type: SavedGroupType;
  condition?: string;
  attributeKey?: string;
  values?: string[];
  dateUpdated: Date;
  dateCreated: Date;
  description?: string;
  projects?: string[];
  useEmptyListGroup?: boolean;
}
export type SavedGroupType = "condition" | "list";

// SQL formatter dialect type that automatically stays in sync with sql-formatter
export type FormatDialect = FormatOptions["language"] | "";

export interface FormatError {
  error: Error;
  originalSql: string;
}

export type TaxIdType = Stripe.CustomerCreateTaxIdParams.Type;

export type StripeAddress = Stripe.Address;
