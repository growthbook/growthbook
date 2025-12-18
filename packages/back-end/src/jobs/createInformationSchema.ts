import Agenda, { Job } from "agenda";
import { InformationSchemaError } from "shared/types/integrations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getInformationSchemaByDatasourceId,
  updateInformationSchemaById,
} from "back-end/src/models/InformationSchemaModel";
import { initializeDatasourceInformationSchema } from "back-end/src/services/informationSchema";
import {
  DataSourceNotSupportedError,
  MissingDatasourceParamsError,
} from "back-end/src/types/Integration";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const CREATE_INFORMATION_SCHEMA_JOB_NAME = "createInformationSchema";
type CreateInformationSchemaJob = Job<{
  datasourceId: string;
  organization: string;
}>;

const createInformationSchema = async (job: CreateInformationSchemaJob) => {
  const { datasourceId, organization } = job.attrs.data;

  if (!datasourceId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

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
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(CREATE_INFORMATION_SCHEMA_JOB_NAME, createInformationSchema);
}

export async function queueCreateInformationSchema(
  datasourceId: string,
  organization: string,
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
