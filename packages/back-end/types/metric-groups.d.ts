import { CreateProps, UpdateProps } from "../src/models/BaseModel";

export interface MetricGroupInterface {
  id: string;
  name: string;
  description?: string;
  datasource: string;
  metrics: string[];
  projects: string[];
  tags?: string[];
  organization: string;
  owner: string;
  dateCreated: Date;
}

export type CreateMetricGroupProps = CreateProps<MetricGroupInterface>;
export type UpdateMetricGroupProps = UpdateProps<MetricGroupInterface>;
