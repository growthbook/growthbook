export interface TagInterface {
  organization: string;
  tags: string[];
  settings: { [key: string]: TagSettings };
}

export interface TagSettings {
  color: string;
  description: string;
}
