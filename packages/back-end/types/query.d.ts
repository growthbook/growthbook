import { QueryLanguage } from "./datasource";

export type QueryStatus =
  | "running"
  | "failed"
  | "partially-succeeded"
  | "succeeded";

export type QueryPointer = {
  query: string;
  status: QueryStatus;
  name: string;
};
export type Queries = QueryPointer[];

export interface QueryInterface {
  id: string;
  organization: string;
  datasource: string;
  language: QueryLanguage;
  query: string;
  status: QueryStatus;
  createdAt: Date;
  startedAt: Date;
  finishedAt?: Date;
  heartbeat: Date;
  // eslint-disable-next-line
  result?: Record<string, any>;
  rawResult?: Record<string, number | string | boolean>[];
  error?: string;
}
