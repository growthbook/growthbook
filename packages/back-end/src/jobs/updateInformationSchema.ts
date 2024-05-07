import Agenda, { Job } from "agenda";
import { updateDatasourceInformationSchema } from "../services/informationSchema";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  getInformationSchemaByDatasourceId,
  getInformationSchemaById,
  updateInformationSchemaById,
} from "../models/InformationSchemaModel";
import {
  DataSourceNotSupportedError,
  InformationSchemaError,
  MissingDatasourceParamsError,
} from "../types/Integration";
import { getContextForAgendaJobByOrgId } from "../services/organizations";
import { trackJob } from "../services/otel";

const UPDATE_INFORMATION_SCHEMA_JOB_NAME = "updateInformationSchema";
type UpdateInformationSchemaJob = Job<{
  datasourceId: string;
  organization: string;
  informationSchemaId: string;
}>;

const updateInformationSchema = trackJob(
  UPDATE_INFORMATION_SCHEMA_JOB_NAME,
  async (job: UpdateInformationSchemaJob) => {
    const { datasourceId, organization, informationSchemaId } = job.attrs.data;

    if (!datasourceId || !organization) return;

    const context = await getContextForAgendaJobByOrgId(organization);

    const datasource = await getDataSourceById(context, datasourceId);

    const informationSchema = await getInformationSchemaById(
      organization,
      informationSchemaId,
    );

    if (!datasource || !informationSchema) return;

    try {
      await updateDatasourceInformationSchema(
        context,
        datasource,
        informationSchema,
      );
    } catch (e) {
      const error: InformationSchemaError = {
        errorType: "generic",
        message: e.message,
      };
      if (e instanceof DataSourceNotSupportedError) {
        error.errorType = "not_supported";
      }
      if (e instanceof MissingDatasourceParamsError) {
        error.errorType = "missing_params";
      }
      const informationSchema = await getInformationSchemaByDatasourceId(
        datasource.id,
        organization,
      );
      if (informationSchema) {
        await updateInformationSchemaById(organization, informationSchema.id, {
          ...informationSchema,
          status: "COMPLETE",
          error,
        });
      }
    }
  },
);

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    UPDATE_INFORMATION_SCHEMA_JOB_NAME,

    updateInformationSchema,
  );
}

export async function queueUpdateInformationSchema(
  datasourceId: string,
  organization: string,
  informationSchemaId: string,
) {
  if (!datasourceId || !organization) return;

  const job = agenda.create(UPDATE_INFORMATION_SCHEMA_JOB_NAME, {
    datasourceId,
    organization,
    informationSchemaId,
  }) as UpdateInformationSchemaJob;
  job.unique({ datasource: datasourceId, organization });
  job.schedule(new Date());
  await job.save();
}
