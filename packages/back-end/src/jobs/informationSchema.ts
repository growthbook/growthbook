import Agenda, { Job } from "agenda";
import { DataSourceInterface } from "../../types/datasource";
import { initializeDatasourceInformationSchema } from "../services/datasource";
import { logger } from "../util/logger";
import { updateDataSource } from "../models/DataSourceModel";

const CREATE_INFORMATION_SCHEMA_JOB_NAME = "createInformationSchema";
type CreateInformationSchemaJob = Job<{
  datasource: DataSourceInterface;
  organization: string;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    CREATE_INFORMATION_SCHEMA_JOB_NAME,
    async (job: CreateInformationSchemaJob) => {
      if (!job.attrs.data) return;
      const { datasource, organization } = job.attrs.data;

      if (!datasource || !organization) return;

      try {
        await initializeDatasourceInformationSchema(datasource, organization);
      } catch (e) {
        // Update the datasource.settings.informationSchema object to reflect the error.
        await updateDataSource(datasource.id, organization, {
          settings: {
            ...datasource.settings,
            informationSchema: {
              id: undefined,
              status: "complete",
              error: e.message,
            },
          },
        });
        logger.error(
          e,
          "Unable to generate information schema for datasource: " +
            "datasource.id." +
            " Error: " +
            e.message
        );
      }
    }
  );
}

export async function queueCreateInformationSchema(
  datasource: DataSourceInterface,
  organization: string
) {
  if (!datasource || !organization) return;

  const job = agenda.create(CREATE_INFORMATION_SCHEMA_JOB_NAME, {
    datasource,
    organization,
  }) as CreateInformationSchemaJob;
  job.unique({ datasource: datasource.id, organization });
  job.schedule(new Date());
  await job.save();
}
