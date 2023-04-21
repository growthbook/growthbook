import { StatsEngine } from "./stats";

export interface ProjectInterface {
  id: string;
  organization: string;
  name: string;
  description?: string;
  dateCreated: Date;
  dateUpdated: Date;
  settings: ProjectSettings;
}

export interface ProjectSettings {
  statsEngine?: StatsEngine;
}
