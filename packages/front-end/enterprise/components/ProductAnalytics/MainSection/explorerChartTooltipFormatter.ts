import {
  formatDateByGranularity,
  type ResolvedGranularity,
} from "@/enterprise/components/ProductAnalytics/util";
import {
  getAlignedComparisonDimensionKeyForTooltip,
  parseComparisonTooltipSeriesName,
  sortProductAnalyticsTooltipAxisItems,
  type IndividualBarComparePivotSlot,
} from "@/enterprise/components/ProductAnalytics/compareUtil";

function escapeHtmlForProductAnalyticsTooltip(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ExplorerIndividualBarComparePivot = {
  categoryAxisData: string[];
  slots: IndividualBarComparePivotSlot[];
  series: unknown[];
};

type TooltipAxisItem = {
  axisValue: string | number;
  dataIndex?: number;
  marker: string;
  seriesName: string;
  value: number | [number, number];
};

function buildGroupedLineAreaCompareTooltipRows(
  formatNumber: (value: number) => string,
  items: Array<{
    marker: string;
    seriesName: string;
    value: number | [number, number];
  }>,
  comparisonPeriodLabels: { currentLabel: string; previousLabel: string },
): string {
  const groupKey = (seriesName: string) => {
    const { baseName } = parseComparisonTooltipSeriesName(
      seriesName,
      comparisonPeriodLabels,
    );
    return baseName === "" ? "\0pivot\0" : baseName;
  };
  const parse = (seriesName: string) =>
    parseComparisonTooltipSeriesName(seriesName, comparisonPeriodLabels);

  const fmtVal = (item: (typeof items)[0]) => {
    const numValue = Array.isArray(item.value) ? item.value[1] : item.value;
    return typeof numValue === "number"
      ? formatNumber(numValue)
      : String(numValue);
  };

  let idx = 0;
  const blocks: string[] = [];
  let blockIndex = 0;
  while (idx < items.length) {
    const key = groupKey(items[idx].seriesName);
    const group: typeof items = [];
    while (idx < items.length && groupKey(items[idx].seriesName) === key) {
      group.push(items[idx]);
      idx += 1;
    }
    const currentItem = group.find(
      (it) => parse(it.seriesName).period === "current",
    );
    const previousItem = group.find(
      (it) => parse(it.seriesName).period === "previous",
    );
    const neutrals = group.filter(
      (it) => parse(it.seriesName).period === "neutral",
    );

    const baseName = parse(group[0].seriesName).baseName;
    const title =
      baseName.trim() !== ""
        ? escapeHtmlForProductAnalyticsTooltip(baseName)
        : null;

    const marginTop = blockIndex === 0 ? "0" : "6px";
    blockIndex += 1;

    const inner: string[] = [];
    if (title) {
      inner.push(`<div style="font-weight:600">${title}</div>`);
    }
    if (currentItem || previousItem) {
      inner.push(
        `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px">`,
      );
      inner.push(
        currentItem
          ? `<span>${currentItem.marker}<b>${fmtVal(currentItem)}</b></span>`
          : `<span></span>`,
      );
      inner.push(
        previousItem
          ? `<span>${previousItem.marker}<b>${fmtVal(previousItem)}</b></span>`
          : `<span></span>`,
      );
      inner.push(`</div>`);
    }
    for (const n of neutrals) {
      inner.push(
        `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px"><span>${n.marker}${escapeHtmlForProductAnalyticsTooltip(n.seriesName)}</span><span><b>${fmtVal(n)}</b></span></div>`,
      );
    }
    if (!title && !currentItem && !previousItem) {
      for (const it of group) {
        inner.push(
          `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:2px"><span>${it.marker}${escapeHtmlForProductAnalyticsTooltip(it.seriesName)}</span><span><b>${fmtVal(it)}</b></span></div>`,
        );
      }
    }
    blocks.push(`<div style="margin-top:${marginTop}">${inner.join("")}</div>`);
  }
  return blocks.join("");
}

export type BuildExplorerChartTooltipFormatterArgs = {
  individualBarComparePivot: ExplorerIndividualBarComparePivot | null;
  resolvedGranularity: ResolvedGranularity | null;
  firstDimensionIsDate: boolean;
  comparisonPeriodLabels: {
    currentLabel: string;
    previousLabel: string;
  } | null;
  showLineAreaCompareTooltipDates: boolean;
  alignedComparisonOverlay: { comparisonXValues: string[] } | null;
  sortedXValues: string[];
  seriesConfigsLength: number;
  formatNumber: (value: number) => string;
};

export function buildExplorerChartTooltipFormatter({
  individualBarComparePivot,
  resolvedGranularity,
  firstDimensionIsDate,
  comparisonPeriodLabels,
  showLineAreaCompareTooltipDates,
  alignedComparisonOverlay,
  sortedXValues,
  seriesConfigsLength,
  formatNumber,
}: BuildExplorerChartTooltipFormatterArgs):
  | ((params: unknown) => string)
  | undefined {
  if (individualBarComparePivot) {
    return (params: unknown) => {
      const itemsRaw = (
        Array.isArray(params) ? params : [params]
      ) as TooltipAxisItem[];
      if (!itemsRaw.length) return "";
      const items = sortProductAnalyticsTooltipAxisItems(
        itemsRaw,
        comparisonPeriodLabels,
      );
      const idx =
        typeof items[0].dataIndex === "number" ? items[0].dataIndex : 0;
      const slot = individualBarComparePivot.slots[idx];
      if (!slot) return "";

      const dimHeader =
        firstDimensionIsDate && resolvedGranularity
          ? (() => {
              const d = new Date(slot.x);
              return Number.isNaN(d.getTime())
                ? slot.x
                : formatDateByGranularity(d, resolvedGranularity);
            })()
          : slot.x;

      const header = `<div style="margin-bottom:4px"><div>${dimHeader}</div><div style="font-size:12px;opacity:0.9">${slot.attributeName}</div></div>`;

      const seriesRows = items
        .map((item) => {
          const numValue = Array.isArray(item.value)
            ? item.value[1]
            : item.value;
          const formatted =
            typeof numValue === "number"
              ? formatNumber(numValue)
              : String(numValue);
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker}${item.seriesName}</span><span><b>${formatted}</b></span></div>`;
        })
        .join("");

      return `<div>${header}${seriesRows}</div>`;
    };
  }

  if (resolvedGranularity) {
    return (params: unknown) => {
      const itemsRaw = (Array.isArray(params) ? params : [params]) as Omit<
        TooltipAxisItem,
        "dataIndex"
      >[];
      if (!itemsRaw.length) return "";
      const items = sortProductAnalyticsTooltipAxisItems(
        itemsRaw,
        comparisonPeriodLabels,
      );

      const rawAxisValue = items[0].axisValue;
      const date =
        typeof rawAxisValue === "number"
          ? new Date(rawAxisValue)
          : new Date(String(rawAxisValue));
      let header: string;
      let groupedLineAreaCompareRows = false;
      if (
        showLineAreaCompareTooltipDates &&
        alignedComparisonOverlay &&
        resolvedGranularity &&
        comparisonPeriodLabels
      ) {
        const axisMs =
          typeof rawAxisValue === "number"
            ? rawAxisValue
            : new Date(String(rawAxisValue)).getTime();
        const currentX = sortedXValues.find(
          (xv) => new Date(xv).getTime() === axisMs,
        );
        if (
          currentX !== undefined &&
          !Number.isNaN(new Date(currentX).getTime())
        ) {
          const compKey = getAlignedComparisonDimensionKeyForTooltip(
            sortedXValues,
            alignedComparisonOverlay.comparisonXValues,
            currentX,
            firstDimensionIsDate,
          );
          const currentFormatted = formatDateByGranularity(
            new Date(currentX),
            resolvedGranularity,
          );
          if (
            compKey !== undefined &&
            !Number.isNaN(new Date(compKey).getTime())
          ) {
            const prevFormatted = formatDateByGranularity(
              new Date(compKey),
              resolvedGranularity,
            );
            groupedLineAreaCompareRows = true;
            header = `<div>${escapeHtmlForProductAnalyticsTooltip(`Current: ${currentFormatted}`)}</div><div style="font-size:12px;opacity:0.9">${escapeHtmlForProductAnalyticsTooltip(`Previous: ${prevFormatted}`)}</div>`;
          } else {
            header = escapeHtmlForProductAnalyticsTooltip(
              `Current: ${currentFormatted}`,
            );
          }
        } else {
          header = escapeHtmlForProductAnalyticsTooltip(
            formatDateByGranularity(date, resolvedGranularity),
          );
        }
      } else {
        header = escapeHtmlForProductAnalyticsTooltip(
          formatDateByGranularity(date, resolvedGranularity),
        );
      }

      const seriesRows =
        groupedLineAreaCompareRows && comparisonPeriodLabels
          ? buildGroupedLineAreaCompareTooltipRows(
              formatNumber,
              items,
              comparisonPeriodLabels,
            )
          : items
              .map((item) => {
                const numValue = Array.isArray(item.value)
                  ? item.value[1]
                  : item.value;
                const formatted =
                  typeof numValue === "number"
                    ? formatNumber(numValue)
                    : String(numValue);
                return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker}${item.seriesName}</span><span><b>${formatted}</b></span></div>`;
              })
              .join("");

      return `<div><div style="margin-bottom:4px">${header}</div>${seriesRows}</div>`;
    };
  }

  if (seriesConfigsLength > 1) {
    return (params: unknown) => {
      const itemsRaw = (Array.isArray(params) ? params : [params]) as Omit<
        TooltipAxisItem,
        "dataIndex"
      >[];
      if (!itemsRaw.length) return "";
      const items = sortProductAnalyticsTooltipAxisItems(
        itemsRaw,
        comparisonPeriodLabels,
      );
      const rawAxisValue = items[0].axisValue;
      const header =
        typeof rawAxisValue === "number"
          ? formatNumber(rawAxisValue)
          : String(rawAxisValue);

      const seriesRows = items
        .map((item) => {
          const numValue = Array.isArray(item.value)
            ? item.value[1]
            : item.value;
          const formatted =
            typeof numValue === "number"
              ? formatNumber(numValue)
              : String(numValue);
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker}${item.seriesName}</span><span><b>${formatted}</b></span></div>`;
        })
        .join("");

      return `<div><div style="margin-bottom:4px">${header}</div>${seriesRows}</div>`;
    };
  }

  return undefined;
}
