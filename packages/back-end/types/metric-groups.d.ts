import { CreateProps } from "back-end/src/models/BaseModel";

export interface MetricGroupInterface {
  id: string;
  name: string;
  description: string;
  datasource: string;
  metrics: string[];
  projects: string[];
  tags: string[];
  organization: string;
  owner: string;
  archived: boolean;
  dateCreated: Date;
  dateUpdated: Date;
}

export type CreateMetricGroupProps = CreateProps<MetricGroupInterface>;
