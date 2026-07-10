export interface TagInterface {
  id: string;
  color: string;
  description: string;
}

export interface TagDBInterface {
  organization: string;
  tags: string[];
  settings: { [key: string]: TagSettings };
  dateUpdated?: Date;
}

export interface TagSettings {
  color: string;
  description: string;
}
