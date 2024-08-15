import type { Response } from "express";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import uniqid from "uniqid";
import { AutoFactMetricToCreate } from "../../types/Integration";
import { ReqContext } from "../../../types/organization";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateFactFilterProps,
  CreateFactTableProps,
  FactMetricInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
  TestFactFilterProps,
  FactFilterTestResults,
} from "../../../types/fact-table";
import {
  createFactTable,
  getAllFactTablesForOrganization,
  getFactTable,
  updateColumn,
  updateFactTable,
  deleteFactTable as deleteFactTableInDb,
  deleteFactFilter as deleteFactFilterInDb,
  createFactFilter,
  updateFactFilter,
} from "../../models/FactTableModel";
import { addTags, addTagsDiff } from "../../models/TagModel";
import {
  getIntegrationFromDatasourceId,
  getSourceIntegrationObject,
} from "../../services/datasource";
import { getDataSourceById } from "../../models/DataSourceModel";
import { DataSourceInterface } from "../../../types/datasource";
import { runRefreshColumnsQuery } from "../../jobs/refreshFactTableColumns";

export const getFactTables = async (
  req: AuthRequest,
  res: Response<{ status: 200; factTables: FactTableInterface[] }>
) => {
  const context = getContextFromReq(req);

  const factTables = await getAllFactTablesForOrganization(context);

  res.status(200).json({
    status: 200,
    factTables,
  });
};

async function testFilterQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  filter: string
): Promise<FactFilterTestResults> {
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery({
    // Must have a newline after factTable sql in case it ends with a comment
    query: `SELECT * FROM (
      ${factTable.sql}
    ) f WHERE ${filter}`,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: context.org.settings?.testQueryDays,
  });

  try {
    const results = await integration.runTestQuery(sql);
    return {
      sql,
      ...results,
    };
  } catch (e) {
    return {
      sql,
      error: e.message,
    };
  }
}

export const postFactTable = async (
  req: AuthRequest<CreateFactTableProps>,
  res: Response<{ status: 200; factTable: FactTableInterface }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateFactTable(data)) {
    context.permissions.throwPermissionError();
  }

  if (!data.datasource) {
    throw new Error("Must specify a data source for this fact table");
  }
  const datasource = await getDataSourceById(context, data.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  data.columns = await runRefreshColumnsQuery(
    context,
    datasource,
    data as FactTableInterface
  );
  if (!data.columns.length) {
    throw new Error("SQL did not return any rows");
  }

  const factTable = await createFactTable(context, data);
  if (data.tags.length > 0) {
    await addTags(context.org.id, data.tags);
  }

  res.status(200).json({
    status: 200,
    factTable,
  });
};

export const putFactTable = async (
  req: AuthRequest<UpdateFactTableProps, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, data)) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  // Update the columns
  data.columns = await runRefreshColumnsQuery(context, datasource, {
    ...factTable,
    ...data,
  } as FactTableInterface);
  data.columnsError = null;

  if (!data.columns.some((col) => !col.deleted)) {
    throw new Error("SQL did not return any rows");
  }

  await updateFactTable(context, factTable, data);

  await addTagsDiff(context.org.id, factTable.tags, data.tags || []);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactTable = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }
  if (!context.permissions.canDeleteFactTable(factTable)) {
    context.permissions.throwPermissionError();
  }

  // check if for fact segments using this before deleting
  const segments = await context.models.segments.getByFactTableId(factTable.id);

  if (segments.length) {
    throw new Error(
      `The following segments are defined via this fact table: ${segments.map(
        (segment) => `\n - ${segment.name}`
      )}`
    );
  }

  await deleteFactTableInDb(context, factTable);

  res.status(200).json({
    status: 200,
  });
};

export const putColumn = async (
  req: AuthRequest<UpdateColumnProps, { id: string; column: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canUpdateFactTable(factTable, {})) {
    context.permissions.throwPermissionError();
  }

  await updateColumn(factTable, req.params.column, data);

  res.status(200).json({
    status: 200,
  });
};

export const postFactFilterTest = async (
  req: AuthRequest<TestFactFilterProps, { id: string }>,
  res: Response<{
    status: 200;
    result: FactFilterTestResults;
  }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const result = await testFilterQuery(
    context,
    datasource,
    factTable,
    data.value
  );

  res.status(200).json({
    status: 200,
    result,
  });
};

export const postFactFilter = async (
  req: AuthRequest<CreateFactFilterProps, { id: string }>,
  res: Response<{ status: 200; filterId: string }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  const filter = await createFactFilter(factTable, data);

  res.status(200).json({
    status: 200,
    filterId: filter.id,
  });
};

export const putFactFilter = async (
  req: AuthRequest<UpdateFactFilterProps, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  if (!context.permissions.canCreateAndUpdateFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  await updateFactFilter(context, factTable, req.params.filterId, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactFilter = async (
  req: AuthRequest<null, { id: string; filterId: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find filter table with that id");
  }
  if (!context.permissions.canDeleteFactFilter(factTable)) {
    context.permissions.throwPermissionError();
  }

  //Before deleting a fact filter, check if it's used by a fact segment
  const segments = (
    await context.models.segments.getByFactTableId(factTable.id)
  ).filter((segment) => segment.filters?.includes(req.params.filterId));

  if (segments.length) {
    throw new Error(
      `The following segments are using this filter: ${segments.map(
        (segment) => `\n - ${segment.name}`
      )}`
    );
  }

  await deleteFactFilterInDb(context, factTable, req.params.filterId);

  res.status(200).json({
    status: 200,
  });
};

export const getFactMetrics = async (
  req: AuthRequest,
  res: Response<{ status: 200; factMetrics: FactMetricInterface[] }>
) => {
  const context = getContextFromReq(req);

  const factMetrics = await context.models.factMetrics.getAll();

  res.status(200).json({
    status: 200,
    factMetrics,
  });
};

export const postFactMetric = async (
  req: AuthRequest<unknown>,
  res: Response<{ status: 200; factMetric: FactMetricInterface }>
) => {
  const context = getContextFromReq(req);
  const data = context.models.factMetrics.createValidator.parse(req.body);

  const factMetric = await context.models.factMetrics.create(data);

  res.status(200).json({
    status: 200,
    factMetric,
  });
};

export const putFactMetric = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);
  const data = context.models.factMetrics.updateValidator.parse(req.body);

  await context.models.factMetrics.updateById(req.params.id, data);

  res.status(200).json({
    status: 200,
  });
};

export const deleteFactMetric = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  await context.models.factMetrics.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};

export const getFactMetricsFromFactTable = async (
  req: AuthRequest<null, { id: string }>,
  res: Response
) => {
  const context = getContextFromReq(req);

  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find fact table with that id");
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    factTable.datasource
  );

  try {
    if (
      !integration.getSourceProperties().supportsAutoGeneratedFactTables ||
      !integration.getAutoFactMetricsToCreate
    ) {
      throw new Error(
        "Datasource does not support automatic fact metric generation"
      );
    }

    // Get existing fact metrics for this fact table
    //TODO: Can I instead just pass these in? - Maybe not to make it more reusable
    //TODO: Create a method on the FactMetricModel to getFactMetricsByFactTableId
    const allFactMetrics = await context.models.factMetrics.getAll();

    const existingFactMetrics = allFactMetrics.filter(
      (m) =>
        m.numerator.factTableId === factTable.id ||
        (m.denominator && m.denominator.factTableId === factTable.id)
    );

    // get autoMetricsToCreate - pass in existing metrics
    const autoFactMetricsToCreate = await integration.getAutoFactMetricsToCreate(
      existingFactMetrics,
      factTable
    );

    return res.status(200).json({ status: 200, autoFactMetricsToCreate });
  } catch (e) {
    res.status(200).json({
      status: 200,
      autoFactTablesToCreate: [],
      message: e.message,
    });
    return;
  }
};

export const postAutoFactMetrics = async (
  req: AuthRequest<
    { autoFactMetricsToCreate: AutoFactMetricToCreate[] },
    { id: string }
  >,
  res: Response<{ status: 200; factMetric: FactMetricInterface }>
) => {
  const context = getContextFromReq(req);

  const metricsToCreate: FactMetricInterface[] = req.body.autoFactMetricsToCreate.map(
    (metric) => {
      return {
        // TODO: Switch this back to being the CreateFactMetricProps (aka, remove id, date, org, etc)
        // TODO: Figure out how to set the defaults here in a better way
        // TODO: Only pass these in if shouldCreate is true
        id: uniqid("fact__"),
        dateCreated: new Date(),
        dateUpdated: new Date(),
        organization: context.org.id,
        owner: "",
        datasource: metric.datasource,
        name: metric.name,
        description: "",
        tags: [],
        projects: [],
        inverse: metric.inverse,
        metricType: metric.metricType,
        numerator: metric.numerator,
        denominator: metric.denominator,
        cappingSettings: {
          type: "",
          value: 0,
        },
        priorSettings: {
          override: false,
          proper: false,
          mean: 0,
          stddev: DEFAULT_PROPER_PRIOR_STDDEV,
        },
        maxPercentChange: 0,
        minPercentChange: 0,
        winRisk: DEFAULT_WIN_RISK_THRESHOLD,
        loseRisk: DEFAULT_LOSE_RISK_THRESHOLD,
        regressionAdjustmentDays: 0,
        regressionAdjustmentEnabled: false,
        regressionAdjustmentOverride: false,
        quantileSettings: null,
        minSampleSize: 150,
        windowSettings: {
          type: DEFAULT_FACT_METRIC_WINDOW,
          delayHours: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
          windowValue: DEFAULT_METRIC_WINDOW_HOURS,
          windowUnit: "hours",
        },
      };
    }
  );

  try {
    //TODO: Instead of doing it directly, queue it up in a job
    await context.models.factMetrics.createFactMetrics(metricsToCreate);
    res.status(204);
  } catch (e) {
    throw new Error(
      `Unable to generate metrics automatically. Reason: ${e.message}`
    );
  }
};
