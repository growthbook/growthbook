import Agenda, { Job } from "agenda";
import { getFactTable, updateFactTable } from "../models/FactTableModel";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  FactTableColumnType,
  FactTableInterface,
  UpdateFactTableProps,
} from "../../types/fact-table";
import { determineColumnTypes } from "../util/sql";
import { getSourceIntegrationObject } from "../services/datasource";

const JOB_NAME = "refreshFactTableColumns";
type RefreshFactTableColumnsJob = Job<{
  organization: string;
  factTableId: string;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(JOB_NAME, async (job: RefreshFactTableColumnsJob) => {
    const { organization, factTableId } = job.attrs.data;

    if (!factTableId || !organization) return;

    const factTable = await getFactTable(organization, factTableId);
    if (!factTable) return;

    const datasource = await getDataSourceById(
      factTable.datasource,
      organization
    );
    if (!datasource) return;

    const updates: UpdateFactTableProps = {};
    try {
      const integration = getSourceIntegrationObject(datasource, true);

      if (!integration.getTestQuery || !integration.runTestQuery) {
        throw new Error("Testing not supported on this data source");
      }

      const sql = integration.getTestQuery(factTable.sql, {
        eventName: factTable.eventName,
      });

      const result = await integration.runTestQuery(sql, ["timestamp"]);

      const typeMap = new Map<string, FactTableColumnType>();
      determineColumnTypes(result.results).forEach((col) => {
        typeMap.set(col.column, col.datatype);
      });

      const columns = factTable.columns || [];

      // Update existing column
      columns.forEach((col) => {
        const type = typeMap.get(col.column);

        // Column no longer exists, mark as deleted
        if (type === undefined) {
          col.deleted = true;
          col.dateUpdated = new Date();
        }
        // Column exists
        else {
          if (col.deleted) {
            col.deleted = false;
            col.dateUpdated = new Date();
          }

          // If we now know the datatype, update it
          if (col.datatype === "" && type !== "") {
            col.datatype = type;
            col.dateUpdated = new Date();
          }
        }
      });

      // Add new columns that don't exist yet
      typeMap.forEach((datatype, column) => {
        if (!columns.some((c) => c.column === column)) {
          columns.push({
            column,
            datatype,
            dateCreated: new Date(),
            dateUpdated: new Date(),
            description: "",
            name: column,
            numberFormat: "",
            deleted: false,
          });
        }
      });

      updates.columns = columns;
      updates.columnsError = null;
    } catch (e) {
      updates.columnsError = e.message;
    }

    await updateFactTable(factTable, updates, null);
  });
}

export async function queueFactTableColumnsRefresh(
  factTable: FactTableInterface
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
