import Agenda, { Job } from "agenda";
import { initializeDatasourceInformationSchema } from "../services/informationSchema";
import { logger } from "../util/logger";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  getInformationSchemaByDatasourceId,
  updateInformationSchemaById,
} from "../models/InformationSchemaModel";

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
        const informationSchema = await getInformationSchemaByDatasourceId(
          datasource.id,
          organization
        );
        if (informationSchema) {
          await updateInformationSchemaById(
            organization,
            informationSchema.id,
            {
              ...informationSchema,
              status: "COMPLETE",
              error: e.message,
            }
          );
        }
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
