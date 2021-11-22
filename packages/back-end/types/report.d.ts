import { SnapshotVariation } from "./experiment-snapshot";
import { Queries } from "./query";

export interface ReportInterfaceBase {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  organization: string;
  links: {
    href: string;
    display: string;
    external: boolean;
  }[];
  title: string;
  description: string;
  runStarted: Date | null;
  error?: string;
  queries: Queries;
}

export interface ExperimentReportInterface extends ReportInterfaceBase {
  type: "experiment";
  args: {
    trackingKey: string;
    datasource: string;
    userIdType?: "anonymous" | "user";
    startDate: Date;
    endDate?: Date;
    dimension?: string;
    variations: {
      id: string;
      name: string;
      weight: number;
    }[];
    segment?: string;
    metrics: string[];
    guardrails?: string[];
    activationMetric?: string;
    queryFilter?: string;
    skipPartialData?: boolean;
  };
  results?: {
    name: string;
    srm: number;
    variations: SnapshotVariation[];
  }[];
}

export type ReportInterface = ExperimentReportInterface;
