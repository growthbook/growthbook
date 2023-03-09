import { DataSourceInterface } from "../../types/datasource";
import { initializeDatasourceInformationSchema } from "../services/datasource";
import { getAgendaInstance } from "../services/queueing";
import { logger } from "../util/logger";

export default async function queueCreateInformationSchema(
  datasource: DataSourceInterface,
  organization: string
) {
  const agenda = getAgendaInstance();

  agenda.define("generate datasource informationSchema", async () => {
    const informationSchemaId = await initializeDatasourceInformationSchema(
      datasource,
      organization
    );

    if (!informationSchemaId) {
      logger.error(
        "Unable to generate information schema for datasource: " + datasource.id
      );
    }
  });

  (async function () {
    const job = agenda.create("generate datasource informationSchema", {
      datasource,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  })();
}
