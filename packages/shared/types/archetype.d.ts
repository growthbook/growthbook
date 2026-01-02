export interface ArchetypeInterface {
  id: string;
  organization: string;
  name: string;
  description: string;
  owner: string;
  isPublic: boolean;
  projects?: string[];
  attributes: string;
  dateUpdated: Date;
  dateCreated: Date;
}

export interface ArchetypeAttributeValues {
  [key: string]: string | number | object | boolean;
}

export type ArchetypeMap = Map<string, string[] | number[]>;
