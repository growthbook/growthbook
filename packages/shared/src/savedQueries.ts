export interface SavedQueryInterface {
  id: string;
  organization: string;
  queryName: string;
  owner: string;
  query: string;
  results?: string;
  dateUpdated: Date;
  dateCreated: Date;
  projects?: string[];
  lastRan: Date;
}
