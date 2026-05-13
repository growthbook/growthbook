import {
  CreateDashboardBlockInterface,
  DashboardBlockData,
  DashboardBlockInterface,
  BlockLayout,
  DASHBOARD_GRID_COLS,
} from "shared/enterprise";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { getFactTablesForDatasource } from "back-end/src/models/FactTableModel";
import {
  BlockIntent,
  BuiltInDashboardTemplate,
  DataSourceInterface,
  FactTableInlineSpec,
  MarkdownIntent,
  MetricExplorationIntent,
  FactTableExplorationIntent,
} from "back-end/src/enterprise/services/dashboard-templates/types";
import {
  findMatchingFactMetric,
  findMatchingFactTable,
} from "back-end/src/enterprise/services/dashboard-templates/matching";

// Top-of-stack y-cursor used to lay out blocks top-to-bottom on a 12-col
// grid when an intent doesn't specify its own layout. Falls back to a
// sensible width-aware default per block type.
type LayoutCursor = { y: number; xRowOffset: number };

function getDefaultSize(intent: BlockIntent): { w: number; h: number } {
  if (intent.type === "markdown") {
    return { w: DASHBOARD_GRID_COLS, h: 3 };
  }
  // For both fact-table-exploration and metric-exploration we default to
  // half-width blocks so charts pack 2-up; templates can override per
  // intent if they want full-width blocks (e.g. a wide top-pages chart).
  return { w: DASHBOARD_GRID_COLS / 2, h: 8 };
}

function placeIntoCursor(
  cursor: LayoutCursor,
  size: { w: number; h: number },
): BlockLayout {
  // If this block won't fit on the current row, wrap to the next row.
  if (cursor.xRowOffset + size.w > DASHBOARD_GRID_COLS) {
    cursor.y += rowHeightAtX(cursor);
    cursor.xRowOffset = 0;
  }
  const layout: BlockLayout = {
    x: cursor.xRowOffset,
    y: cursor.y,
    w: size.w,
    h: size.h,
  };
  cursor.xRowOffset += size.w;
  if (cursor.xRowOffset >= DASHBOARD_GRID_COLS) {
    cursor.y += size.h;
    cursor.xRowOffset = 0;
  }
  return layout;
}

// Helper kept simple: we don't track per-row block heights individually;
// when we wrap we advance by the size of the current block being placed.
// This is good enough for the templates we ship (each row's blocks share
// the same height), and the dashboard model's normalizeLayouts will
// repair any minor overlaps on save.
function rowHeightAtX(_cursor: LayoutCursor): number {
  return 8;
}

function resolveMarkdown(
  intent: MarkdownIntent,
  cursor: LayoutCursor,
): CreateDashboardBlockInterface {
  const size = getDefaultSize(intent);
  const layout = intent.block.layout ?? placeIntoCursor(cursor, size);
  const block: DashboardBlockData<
    Extract<DashboardBlockInterface, { type: "markdown" }>
  > = {
    type: "markdown",
    title: intent.block.title,
    description: intent.block.description ?? "",
    content: intent.block.content,
    layout,
  };
  return block;
}

function buildMetricExplorationBlock(
  intent: MetricExplorationIntent,
  matched: FactMetricInterface,
  datasource: DataSourceInterface,
  layout: BlockLayout,
): CreateDashboardBlockInterface {
  const block: DashboardBlockData<
    Extract<DashboardBlockInterface, { type: "metric-exploration" }>
  > = {
    type: "metric-exploration",
    title: intent.block.title,
    description: intent.block.description ?? "",
    explorerAnalysisId: "",
    layout,
    config: {
      type: "metric",
      datasource: datasource.id,
      dimensions: intent.block.dimensions,
      chartType: intent.block.chartType,
      dateRange: intent.block.dateRange,
      dataset: {
        type: "metric",
        values: [
          {
            type: "metric",
            name: matched.name,
            rowFilters: [],
            metricId: matched.id,
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
    },
  };
  return block;
}

function buildFactTableExplorationBlock(
  inline: FactTableInlineSpec,
  factTable: FactTableInterface,
  title: string,
  description: string | undefined,
  datasource: DataSourceInterface,
  layout: BlockLayout,
): CreateDashboardBlockInterface {
  const block: DashboardBlockData<
    Extract<DashboardBlockInterface, { type: "fact-table-exploration" }>
  > = {
    type: "fact-table-exploration",
    title,
    description: description ?? "",
    explorerAnalysisId: "",
    layout,
    config: {
      type: "fact_table",
      datasource: datasource.id,
      dimensions: inline.dimensions,
      chartType: inline.chartType,
      dateRange: inline.dateRange,
      dataset: {
        type: "fact_table",
        factTableId: factTable.id,
        values: inline.values,
      },
    },
  };
  return block;
}

function resolveMetricExploration(
  intent: MetricExplorationIntent,
  ctx: {
    datasource: DataSourceInterface;
    factTables: FactTableInterface[];
    factTablesById: Map<string, FactTableInterface>;
    factMetrics: FactMetricInterface[];
    cursor: LayoutCursor;
  },
): CreateDashboardBlockInterface | null {
  const matched = findMatchingFactMetric(
    ctx.factMetrics,
    intent.matchSpec,
    ctx.factTablesById,
  );
  const size = getDefaultSize(intent);
  if (matched) {
    const layout = intent.block.layout ?? placeIntoCursor(ctx.cursor, size);
    return buildMetricExplorationBlock(intent, matched, ctx.datasource, layout);
  }
  if (!intent.fallback) {
    logger.info(
      `Skipping metric-exploration intent '${intent.block.title}': no fact-metric match and no fallback declared`,
    );
    return null;
  }
  const fallbackFactTable = findMatchingFactTable(
    ctx.factTables,
    intent.fallback.factTableMatch,
  );
  if (!fallbackFactTable) {
    logger.info(
      `Skipping metric-exploration intent '${intent.block.title}': fallback fact table not found`,
    );
    return null;
  }
  const layout = intent.block.layout ?? placeIntoCursor(ctx.cursor, size);
  return buildFactTableExplorationBlock(
    intent.fallback,
    fallbackFactTable,
    intent.block.title,
    intent.block.description,
    ctx.datasource,
    layout,
  );
}

function resolveFactTableExploration(
  intent: FactTableExplorationIntent,
  ctx: {
    datasource: DataSourceInterface;
    factTables: FactTableInterface[];
    cursor: LayoutCursor;
  },
): CreateDashboardBlockInterface | null {
  const matched = findMatchingFactTable(ctx.factTables, intent.factTableMatch);
  if (!matched) {
    logger.info(
      `Skipping fact-table-exploration intent '${intent.block.title}': no fact table matches required columns ${intent.factTableMatch.requiredColumns.join(", ")}`,
    );
    return null;
  }
  const size = getDefaultSize(intent);
  const layout = intent.block.layout ?? placeIntoCursor(ctx.cursor, size);
  return buildFactTableExplorationBlock(
    {
      factTableMatch: intent.factTableMatch,
      values: intent.values,
      dimensions: intent.dimensions,
      chartType: intent.chartType,
      dateRange: intent.dateRange,
    },
    matched,
    intent.block.title,
    intent.block.description,
    ctx.datasource,
    layout,
  );
}

export async function instantiateTemplate(
  context: ReqContext,
  template: BuiltInDashboardTemplate,
  datasource: DataSourceInterface,
): Promise<{ title: string; blocks: CreateDashboardBlockInterface[] }> {
  const factTables = await getFactTablesForDatasource(context, datasource.id);
  const factTablesById = new Map(factTables.map((ft) => [ft.id, ft]));
  const factMetricDocs = await context.models.factMetrics.getAllSorted({
    datasourceId: datasource.id,
  });

  const { title, blocks: intents } = template.build({ datasource });

  const cursor: LayoutCursor = { y: 0, xRowOffset: 0 };
  const resolved: CreateDashboardBlockInterface[] = [];

  for (const intent of intents) {
    let block: CreateDashboardBlockInterface | null = null;
    switch (intent.type) {
      case "markdown":
        block = resolveMarkdown(intent, cursor);
        break;
      case "metric-exploration":
        block = resolveMetricExploration(intent, {
          datasource,
          factTables,
          factTablesById,
          factMetrics: factMetricDocs,
          cursor,
        });
        break;
      case "fact-table-exploration":
        block = resolveFactTableExploration(intent, {
          datasource,
          factTables,
          cursor,
        });
        break;
    }
    if (block) {
      resolved.push(block);
    }
  }

  return { title, blocks: resolved };
}
