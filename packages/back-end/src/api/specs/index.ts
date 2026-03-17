import { OpenApiModelSpec } from "back-end/src/api/ApiModel";
import { dashboardApiSpec } from "./dashboard.spec";
import { customFieldApiSpec } from "./custom-field.spec";
import { metricGroupApiSpec } from "./metric-group.spec";
import { teamApiSpec } from "./team.spec";
import { experimentTemplateApiSpec } from "./experiment-template.spec";

export const apiSpecs: OpenApiModelSpec[] = [
  dashboardApiSpec,
  customFieldApiSpec,
  metricGroupApiSpec,
  teamApiSpec,
  experimentTemplateApiSpec,
];
