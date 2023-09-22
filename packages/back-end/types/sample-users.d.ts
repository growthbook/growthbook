export interface SampleUsersInterface {
  id: string;
  organization: string;
  name: string;
  description: string;
  owner: string;
  isPublic: boolean;
  attributes: SampleUserAttributeValues;
  dateUpdated: Date;
  dateCreated: Date;
}

export interface SampleUserAttributeValues {
  [key: string]: string | number | object | boolean;
}

export type SampleUsersMap = Map<string, string[] | number[]>;
