import Agenda, { Job } from "agenda";
import { InformationSchemaError } from "shared/types/integrations";
import {
  DataSourceNotSupportedError,
  MissingDatasourceParamsError,
} from "back-end/src/util/errors";
import { updateDatasourceInformationSchema } from "back-end/src/services/informationSchema";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getInformationSchemaById,
  updateInformationSchemaById,
} from "back-end/src/models/InformationSchemaModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const UPDATE_INFORMATION_SCHEMA_JOB_NAME = "updateInformationSchema";
type UpdateInformationSchemaJob = Job<{
  datasourceId: string;
  organization: string;
  informationSchemaId: string;
}>;

const updateInformationSchema = async (job: UpdateInformationSchemaJob) => {
  const { datasourceId, organization, informationSchemaId } = job.attrs.data;

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
    await updateInformationSchemaById(organization, informationSchemaId, {
      status: "COMPLETE",
      error,
    });
  }
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(UPDATE_INFORMATION_SCHEMA_JOB_NAME, updateInformationSchema);
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
