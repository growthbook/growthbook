import { CreateProps } from "shared/types/baseModel";

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
