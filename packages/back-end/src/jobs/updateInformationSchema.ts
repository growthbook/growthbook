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
  organizationId: string;
  informationSchemaId: string;
}>;

const updateInformationSchema = async (job: UpdateInformationSchemaJob) => {
  const { datasourceId, organizationId, informationSchemaId } = job.attrs.data;

  const context = await getContextForAgendaJobByOrgId(organizationId);

  const datasource = await getDataSourceById(context, datasourceId);

  const informationSchema = await getInformationSchemaById(
    organizationId,
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
    await updateInformationSchemaById(organizationId, informationSchemaId, {
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
  organizationId: string,
  informationSchemaId: string,
) {
  if (!datasourceId || !organizationId) return;

  const job = agenda.create(UPDATE_INFORMATION_SCHEMA_JOB_NAME, {
    datasourceId,
    organizationId,
    informationSchemaId,
  }) as UpdateInformationSchemaJob;
  job.unique({ datasource: datasourceId, organization: organizationId });
  job.schedule(new Date());
  await job.save();
}
