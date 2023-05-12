import Agenda, { Job } from "agenda";
import uniqid from "uniqid";
import { getDataSourceById } from "../models/DataSourceModel";
import { insertMetric } from "../models/MetricModel";
import { MetricInterface } from "../../types/metric";

const CREATE_AUTOMATIC_METRICS_JOB_NAME = "createAutomaticMetrics";

type CreateAutomaticMetricsJob = Job<{
  organization: string;
  datasourceId: string;
  metricsToCreate: {
    event: string;
    hasUserId: boolean;
    createForUser: boolean;
  }[];
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    CREATE_AUTOMATIC_METRICS_JOB_NAME,
    async (job: CreateAutomaticMetricsJob) => {
      const { datasourceId, organization, metricsToCreate } = job.attrs.data;

      if (!datasourceId || !organization || !metricsToCreate) return;

      const datasource = await getDataSourceById(datasourceId, organization);

      if (!datasource) return;

      try {
        // This is where I guess I'll loop through the metricsToCreate & call the createMetric function?
        const createdMetrics = metricsToCreate.map(async (metric) => {
          const data: Partial<MetricInterface> = {
            id: uniqid("met_"),
            organization,
            datasource: datasourceId,
            name: metric.event,
            type: "binomial",
            sql: "SELECT * FROM SOMETHING",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            conversionWindowHours: 72,
          };
          return await insertMetric(data);
        });
        console.log("createdMetrics", createdMetrics);
      } catch (e) {
        // Not sure what to do here yet - catch the errors, but what should I do with them?
      }
    }
  );
}

export async function queueCreateAutomaticMetrics(
  datasourceId: string,
  organization: string,
  metricsToCreate: {
    event: string;
    hasUserId: boolean;
    createForUser: boolean;
  }[]
) {
  if (!datasourceId || !organization || !metricsToCreate) return;

  const job = agenda.create(CREATE_AUTOMATIC_METRICS_JOB_NAME, {
    organization,
    datasourceId,
    metricsToCreate,
  }) as CreateAutomaticMetricsJob;
  job.unique({ datasourceId, organization, metricsToCreate });
  job.schedule(new Date());
  await job.save();
}
