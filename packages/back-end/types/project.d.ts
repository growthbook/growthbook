export interface ProjectInterface {
  id: string;
  organization: string;
  metrics?: string[];
  dimensions?: string[];
  segments?: string[];
  name: string;
  dateCreated: Date;
  dateUpdated: Date;
}
