import Agenda, { Job } from "agenda";
import { initializeDatasourceInformationSchema } from "../services/datasource";
import { logger } from "../util/logger";
import { getDataSourceById, updateDataSource } from "../models/DataSourceModel";

const CREATE_INFORMATION_SCHEMA_JOB_NAME = "createInformationSchema";
type CreateInformationSchemaJob = Job<{
  datasourceId: string;
  organization: string;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    CREATE_INFORMATION_SCHEMA_JOB_NAME,
    async (job: CreateInformationSchemaJob) => {
      const { datasourceId, organization } = job.attrs.data;

      if (!datasourceId || !organization) return;

      const datasource = await getDataSourceById(datasourceId, organization);

      if (!datasource) return;

      try {
        await initializeDatasourceInformationSchema(datasource, organization);
      } catch (e) {
        // Update the datasource.settings.informationSchema object to reflect the error.
        await updateDataSource(datasource.id, organization, {
          settings: {
            ...datasource.settings,
            informationSchema: {
              id: datasource.settings.informationSchema?.id || undefined,
              status: "complete",
              error: e.message,
            },
          },
        });
        logger.error(
          e,
          "Unable to generate information schema for datasource: " +
            datasource.id +
            " Error: " +
            e.message
        );
      }
    }
  );
}

export async function queueCreateInformationSchema(
  datasourceId: string,
  organization: string
) {
  if (!datasourceId || !organization) return;

  const job = agenda.create(CREATE_INFORMATION_SCHEMA_JOB_NAME, {
    datasourceId,
    organization,
  }) as CreateInformationSchemaJob;
  job.unique({ datasource: datasourceId, organization });
  job.schedule(new Date());
  await job.save();
}
