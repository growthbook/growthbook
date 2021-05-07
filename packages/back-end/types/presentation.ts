export type PresentationOptions = Record<string, unknown>;

export interface PresentationInterface {
  id: string;
  userId: string;
  organization: string;
  title: string;
  description: string;
  options?: PresentationOptions;
  experimentIds?: string[];
  dateCreated: Date;
  dateUpdated: Date;
}
