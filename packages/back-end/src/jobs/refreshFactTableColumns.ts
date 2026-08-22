import Agenda, { Job } from "agenda";
import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  getFactTable,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { deriveUserIdTypesFromColumns } from "back-end/src/util/factTable";
import {
  mergeRefreshedTopValues,
  refreshColumnTopValues,
  runColumnDetectionQuery,
} from "back-end/src/services/factTableColumns";

const JOB_NAME = "refreshFactTableColumns";

type RefreshFactTableColumnsJob = Job<{
  organization: string;
  factTableId: string;
}>;

const refreshFactTableColumns = async (job: RefreshFactTableColumnsJob) => {
  const { organization, factTableId } = job.attrs.data;

  if (!factTableId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const factTable = await getFactTable(context, factTableId);
  if (!factTable) return;

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    await updateFactTableColumns(
      factTable,
      { columnRefreshPending: false, columnsError: "Datasource not found" },
      context,
    );
    return;
  }

  const columnDetectionChanges: Partial<
    Pick<
      FactTableInterface,
      "columns" | "columnsError" | "columnRefreshPending" | "userIdTypes"
    >
  > = {};
  let detectedColumns: ColumnInterface[] | null = null;

  try {
    detectedColumns = await runColumnDetectionQuery(
      context,
      datasource,
      factTable,
    );
    columnDetectionChanges.columns = detectedColumns;
    columnDetectionChanges.columnsError = null;
    columnDetectionChanges.userIdTypes = deriveUserIdTypesFromColumns(
      datasource,
      detectedColumns,
    );
  } catch (e) {
    columnDetectionChanges.columnsError = e.message;
  }

  // Column types are now known (or detection failed). Clear pending status before the slow top-values
  // scan so metric creation unblocks as soon as types are available.
  columnDetectionChanges.columnRefreshPending = false;
  await updateFactTableColumns(factTable, columnDetectionChanges, context);

  // Top values can take minutes on large tables. Run
  // and persist them after column detection is complete.
  if (detectedColumns) {
    const refreshedColumns = await refreshColumnTopValues(
      context,
      datasource,
      factTable,
      detectedColumns,
    );
    if (refreshedColumns.length === 0) return;

    const currentFactTable = await getFactTable(context, factTableId);
    if (!currentFactTable) return;

    const updatedColumns = mergeRefreshedTopValues({
      currentColumns: currentFactTable.columns,
      currentUserIdTypes: currentFactTable.userIdTypes,
      currentUserIdColumns: currentFactTable.userIdColumns,
      refreshedColumns,
    });
    await updateFactTableColumns(
      currentFactTable,
      { columns: updatedColumns },
      context,
    );
  }
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(JOB_NAME, refreshFactTableColumns);
}

export async function queueFactTableColumnsRefresh(
  factTable: Pick<FactTableInterface, "id" | "organization">,
) {
  const job = agenda.create(JOB_NAME, {
    organization: factTable.organization,
    factTableId: factTable.id,
  }) as RefreshFactTableColumnsJob;
  job.unique({
    organization: factTable.organization,
    factTableId: factTable.id,
  });
  job.schedule(new Date());
  await job.save();
}

/** Same job as queueFactTableColumnsRefresh, but scheduled for a future runAt. */
export async function queueFactTableColumnsRefreshAt(
  factTable: Pick<FactTableInterface, "id" | "organization">,
  runAt: Date,
) {
  const job = agenda.create(JOB_NAME, {
    organization: factTable.organization,
    factTableId: factTable.id,
  }) as RefreshFactTableColumnsJob;
  job.unique({
    organization: factTable.organization,
    factTableId: factTable.id,
  });
  job.schedule(runAt);
  await job.save();
}
