export interface TagInterface {
  name: string;
  color: string;
  description: string;
}

export interface TagDBInterface {
  organization: string;
  tags: string[];
  settings: { [key: string]: TagSettings };
}

export interface TagSettings {
  color: string;
  description: string;
}
