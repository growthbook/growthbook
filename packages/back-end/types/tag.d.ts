export interface TagInterface {
  id: string;
  color: string;
  description: string;
  label: string;
}

export interface TagDBInterface {
  organization: string;
  tags: string[];
  settings: { [key: string]: TagSettings };
}

export interface TagSettings {
  color: string;
  description: string;
  label?: string;
}
