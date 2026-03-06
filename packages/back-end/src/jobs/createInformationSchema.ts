import Agenda, { Job } from "agenda";
import { InformationSchemaError } from "shared/types/integrations";
import {
  DataSourceNotSupportedError,
  MissingDatasourceParamsError,
} from "back-end/src/util/errors";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getInformationSchemaByDatasourceId,
  updateInformationSchemaById,
} from "back-end/src/models/InformationSchemaModel";
import { initializeDatasourceInformationSchema } from "back-end/src/services/informationSchema";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const CREATE_INFORMATION_SCHEMA_JOB_NAME = "createInformationSchema";
type CreateInformationSchemaJob = Job<{
  datasourceId: string;
  organizationId: string;
}>;

const createInformationSchema = async (job: CreateInformationSchemaJob) => {
  const { datasourceId, organizationId } = job.attrs.data;

  if (!datasourceId || !organizationId) return;

  const context = await getContextForAgendaJobByOrgId(organizationId);

  const datasource = await getDataSourceById(context, datasourceId);

  if (!datasource) return;

  try {
    await initializeDatasourceInformationSchema(context, datasource);
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
      organizationId,
    );
    if (informationSchema) {
      await updateInformationSchemaById(organizationId, informationSchema.id, {
        ...informationSchema,
        status: "COMPLETE",
        error,
      });
    }
  }
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(CREATE_INFORMATION_SCHEMA_JOB_NAME, createInformationSchema);
}

export async function queueCreateInformationSchema(
  datasourceId: string,
  organizationId: string,
) {
  if (!datasourceId || !organizationId) return;

  const job = agenda.create(CREATE_INFORMATION_SCHEMA_JOB_NAME, {
    datasourceId,
    organizationId,
  }) as CreateInformationSchemaJob;
  job.unique({ datasource: datasourceId, organization: organizationId });
  job.schedule(new Date());
  await job.save();
}
