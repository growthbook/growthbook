import { DataSourceInterface } from "../../types/datasource";
import { initializeDatasourceInformationSchema } from "../services/datasource";
import { getAgendaInstance } from "../services/queueing";

export default async function queueCreateInformationSchema(
  datasource: DataSourceInterface,
  organization: string
) {
  const agenda = getAgendaInstance();

  agenda.define("generate datasource informationSchema", async () => {
    await initializeDatasourceInformationSchema(datasource, organization);
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
