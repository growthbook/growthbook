import Link from "next/link";
import { useMemo, useState, useCallback } from "react";
import clsx from "clsx";
import {
  PowerCalculationParams,
  PowerCalculationResults,
  PowerCalculationSuccessResults,
} from "shared/power";
import { Box } from "@radix-ui/themes";
import { LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import {
  Tooltip as VisxTooltip,
  useTooltip,
  defaultStyles,
} from "@visx/tooltip";
import { ParentSize } from "@visx/responsive";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { ensureAndReturn } from "@/types/utils";
import { GBHeadingArrowLeft } from "@/components/Icons";
import Frame from "@/ui/Frame";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import PowerCalculationStatsEngineSettingsModal, {
  alphaToChanceToWin,
  StatsEngineSettingsWithAlpha,
} from "./PowerCalculationStatsEngineSettingsModal";

const engineType = {
  frequentist: "Frequentist",
  bayesian: "Bayesian",
} as const;

const percentFormatter = (
  v: number,
  { digits }: { digits: number } = { digits: 0 },
) =>
  isNaN(v)
    ? "N/A"
    : new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: digits,
        roundingMode: "floor",
      }).format(v);

const numberFormatter = (() => {
  const formatter = Intl.NumberFormat("en-US");
  return (v: number) => (isNaN(v) ? "N/A" : formatter.format(v));
})();

const MIN_VARIATIONS = 2;
const MAX_VARIATIONS = 12;

const formatWeeks = ({ weeks, nWeeks }: { weeks?: number; nWeeks: number }) =>
  weeks
    ? `${numberFormatter(weeks)} ${weeks > 1 ? "weeks" : "week"}`
    : `more than ${numberFormatter(nWeeks)} ${nWeeks > 1 ? "weeks" : "week"}`;

const AnalysisSettings = ({
  params,
  results,
  updateVariations,
  updateStatsEngineSettingsWithAlpha,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationResults;
  updateVariations: (_: number) => void;
  updateStatsEngineSettingsWithAlpha: (_: StatsEngineSettingsWithAlpha) => void;
}) => {
  const [currentVariations, setCurrentVariations] = useState<
    number | undefined
  >(params.nVariations);

  const [showStatsEngineSettingsModal, setShowStatsEngineSettingsModal] =
    useState(false);

  const isValidCurrentVariations =
    currentVariations &&
    MIN_VARIATIONS <= currentVariations &&
    currentVariations <= MAX_VARIATIONS;

  return (
    <>
      {showStatsEngineSettingsModal && (
        <PowerCalculationStatsEngineSettingsModal
          close={() => setShowStatsEngineSettingsModal(false)}
          params={{
            ...params.statsEngineSettings,
            alpha: params.alpha,
          }}
          onSubmit={(v) => {
            updateStatsEngineSettingsWithAlpha(v);
            setShowStatsEngineSettingsModal(false);
          }}
        />
      )}
      <Frame>
        <div className="row">
          <div className="col-7">
            <h2>Analysis Settings</h2>
            <p>
              {engineType[params.statsEngineSettings.type]}
              {params.statsEngineSettings.type === "frequentist"
                ? ` (Sequential Testing 
              ${
                params.statsEngineSettings.sequentialTesting
                  ? "enabled"
                  : "disabled"
              }; ${params.alpha} p-value threshold)
              `
                : ` (${alphaToChanceToWin(params.alpha)}% chance to win threshold)
              `}{" "}
              ·{" "}
              <Link
                href="#"
                onClick={() => setShowStatsEngineSettingsModal(true)}
              >
                Edit
              </Link>
            </p>
          </div>
          <div className="vr"></div>
          <div className="col-4 align-self-end">
            <div className="font-weight-bold mb-2"># of Variations</div>
            <div className="form-group d-flex mb-0 flex-row">
              <input
                type="number"
                className={clsx(
                  "form-control w-50 mr-2",
                  !isValidCurrentVariations && "border border-danger",
                )}
                value={currentVariations}
                min={2}
                max={12}
                onChange={(e) => {
                  const varNum =
                    e.target.value !== "" ? Number(e.target.value) : undefined;
                  setCurrentVariations(varNum);
                  updateVariations(varNum ?? 0);
                }}
              />
            </div>
            <small
              className={clsx(
                "form-text text-muted",
                isValidCurrentVariations && "invisible",
              )}
            >
              <div className="text-danger">
                Enter a value between {MIN_VARIATIONS} - {MAX_VARIATIONS}
              </div>
            </small>
          </div>
        </div>

        {results.type === "error" ? (
          <div className="row p-4">
            <Callout status="error">
              Computation failed: {results.description}
            </Callout>
          </div>
        ) : null}
      </Frame>
    </>
  );
};

const MetricLabel = ({
  name,
  effectSize,
}: {
  name: string;
  effectSize: number;
}) => (
  <>
    <div className="font-weight-bold">{name}</div>
    <div className="small">
      Effect Size {percentFormatter(effectSize, { digits: 4 })}
    </div>
  </>
);

const SampleSizeAndRuntime = ({
  params,
  results,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationSuccessResults;
}) => {
  const sampleSizeAndRuntime = results.sampleSizeAndRuntime;
  const [selectedRow, setSelectedRow] = useState(
    Object.keys(sampleSizeAndRuntime)[0],
  );

  const selectedTarget = sampleSizeAndRuntime[selectedRow];
  const { name: selectedName, effectSize: selectedEffectSize } = useMemo(() => {
    const newSelectedRow = params.metrics[selectedRow]
      ? selectedRow
      : Object.keys(sampleSizeAndRuntime)[0];
    setSelectedRow(newSelectedRow);
    return ensureAndReturn(params.metrics[newSelectedRow]);
  }, [params.metrics, selectedRow, sampleSizeAndRuntime, setSelectedRow]);

  return (
    <Frame>
      <div>
        <h2>Calculated Sample Size & Runtime</h2>
        <p>
          Needed sample sizes are based on total number of users across all
          variations.
        </p>
      </div>

      <div className="row">
        <div className="col-7">
          <Table variant="standard" className="appbox">
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Metric</TableColumnHeader>
                <TableColumnHeader>Effect Size</TableColumnHeader>
                <TableColumnHeader>Needed Sample</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(sampleSizeAndRuntime).map((id) => {
                const target = sampleSizeAndRuntime[id];

                const { name, type, effectSize } = ensureAndReturn(
                  params.metrics[id],
                );

                return (
                  <TableRow
                    key={id}
                    className={clsx(
                      "power-analysis-row",
                      selectedRow === id && "selected",
                    )}
                    onClick={() => setSelectedRow(id)}
                  >
                    <TableCell>
                      <div className="font-weight-bold">{name}</div>
                      <div className="small">
                        {type === "binomial" ? "Proportion" : "Mean"}
                      </div>
                    </TableCell>
                    <TableCell>{percentFormatter(effectSize, { digits: 4 })}</TableCell>
                    <TableCell>
                      {target
                        ? `${formatWeeks({
                            weeks: target.weeks,
                            nWeeks: params.nWeeks,
                          })}; ${numberFormatter(target.users)} users`
                        : formatWeeks({ nWeeks: params.nWeeks })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="col-5">
          <div className="card alert alert-info">
            <h4>{selectedName}</h4>
            <p>
              Reliably detecting a lift of{" "}
              <span className="font-weight-bold">
                {percentFormatter(selectedEffectSize, { digits: 1 })}
              </span>{" "}
              requires running your experiment for{" "}
              {selectedTarget ? (
                <>
                  <span className="font-weight-bold">
                    {formatWeeks({
                      weeks: selectedTarget.weeks,
                      nWeeks: params.nWeeks,
                    })}
                  </span>{" "}
                  (collecting roughly{" "}
                  <span className="font-weight-bold">
                    {numberFormatter(selectedTarget.users)} users
                  </span>
                  )
                </>
              ) : (
                <span className="font-weight-bold">
                  {formatWeeks({ nWeeks: params.nWeeks })}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
};

const WeeksThreshold = ({
  nWeeks,
  targetPower,
  weekThreshold,
}: {
  nWeeks: number;
  targetPower: number;
  weekThreshold?: number;
}) =>
  weekThreshold ? (
    <p>
      To achieve {percentFormatter(targetPower)} power for all metrics, we
      advocate running your experiment for{" "}
      <span className="font-weight-bold">
        at least {formatWeeks({ weeks: weekThreshold, nWeeks })}
      </span>
      .
    </p>
  ) : (
    <p>
      The experiment needs to run for{" "}
      <span className="font-weight-bold">{formatWeeks({ nWeeks })}</span> to
      achieve {percentFormatter(targetPower)} power for all metrics.
    </p>
  );

const MinimumDetectableEffect = ({
  results,
  params,
}: {
  results: PowerCalculationSuccessResults;
  params: PowerCalculationParams;
}) => {
  return (
    <Frame>
      <div className="w-100">
        <h2>Minimum Detectable Effect Over Time</h2>
      </div>
      <WeeksThreshold
        nWeeks={params.nWeeks}
        weekThreshold={results.weekThreshold}
        targetPower={params.targetPower}
      />

      <Table variant="standard" className="appbox">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Metric</TableColumnHeader>
            {results.weeks.map(({ users }, idx) => (
              <TableColumnHeader
                key={idx}
                className={clsx(
                  results.weekThreshold === idx + 1 &&
                    "power-analysis-cell-threshold power-analysis-overall-header-threshold",
                )}
              >
                {(() => {
                  const content = (
                    <>
                      <div className="font-weight-bold">
                        Week{` `}
                        {idx + 1}
                      </div>
                      <span className="small">
                        {numberFormatter(users)} Users
                      </span>
                    </>
                  );

                  if (results.weekThreshold === idx + 1)
                    return (
                      <Tooltip
                        popperClassName="text-top"
                        body={`Week ${
                          idx + 1
                        } is the first week when all your metrics meet their expected effect size.`}
                        tipPosition="top"
                      >
                        {content}
                      </Tooltip>
                    );

                  return content;
                })()}
              </TableColumnHeader>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.keys(results.weeks[0]?.metrics).map((id, pos) => (
            <TableRow key={id}>
              <TableCell>
                <MetricLabel {...ensureAndReturn(params.metrics[id])} />
              </TableCell>
              {results.weeks.map(({ metrics }, idx) => (
                <TableCell
                  key={`${id}-${idx}`}
                  className={clsx(
                    ensureAndReturn(metrics[id]).isThreshold &&
                      "power-analysis-cell-threshold",
                    results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-cell-threshold",
                    Object.keys(results.weeks[0]?.metrics).length == pos + 1 &&
                      results.weekThreshold === idx + 1 &&
                      "power-analysis-overall-bottom-threshold",
                  )}
                >
                  {(() => {
                    const content = percentFormatter(
                      ensureAndReturn(metrics[id]).effectSize,
                      {
                        digits: 1,
                      },
                    );

                    if (ensureAndReturn(metrics[id]).isThreshold) {
                      const { effectSize, name } = ensureAndReturn(
                        params.metrics[id],
                      );
                      return (
                        <Tooltip
                          popperClassName="text-top"
                          body={`Week ${
                            idx + 1
                          } is the first week where the minimum detectable effect over time dropped below your target effect size of ${percentFormatter(
                            effectSize,
                            { digits: 1 },
                          )} for ${name}.`}
                          tipPosition="top"
                        >
                          {content}
                        </Tooltip>
                      );
                    }

                    return content;
                  })()}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Box className="appbox p-3">
        <PowerLineGraph
          weeks={results.weeks}
          metrics={params.metrics}
          target={params.metrics[Object.keys(params.metrics)[0]].effectSize}
          targetLabel={"Target Effect Size"}
          dataType="effectSize"
        />
      </Box>
    </Frame>
  );
};

const PowerOverTime = ({
  params,
  results,
}: {
  params: PowerCalculationParams;
  results: PowerCalculationSuccessResults;
}) => (
  <Frame>
    <div className="w-100">
      <h2>Power Over Time</h2>
    </div>
    <WeeksThreshold
      nWeeks={params.nWeeks}
      weekThreshold={results.weekThreshold}
      targetPower={params.targetPower}
    />

    <Table variant="standard" className="appbox">
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Metric</TableColumnHeader>
          {results.weeks.map(({ users }, idx) => (
            <TableColumnHeader
              key={idx}
              className={clsx(
                results.weekThreshold === idx + 1 &&
                  "power-analysis-cell-threshold power-analysis-overall-header-threshold",
              )}
            >
              {(() => {
                const content = (
                  <>
                    <div className="font-weight-bold">
                      Week{` `}
                      {idx + 1}
                    </div>
                    <span className="small">
                      {numberFormatter(users)} Users
                    </span>
                  </>
                );

                if (results.weekThreshold === idx + 1)
                  return (
                    <Tooltip
                      popperClassName="text-top"
                      body={`Week ${
                        idx + 1
                      } is the first week when all your metrics meet their expected effect size.`}
                      tipPosition="top"
                    >
                      {content}
                    </Tooltip>
                  );

                return content;
              })()}
            </TableColumnHeader>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Object.keys(results.weeks[0]?.metrics).map((id, pos) => (
          <TableRow key={id}>
            <TableCell>
              <MetricLabel {...ensureAndReturn(params.metrics[id])} />
            </TableCell>
            {results.weeks.map(({ metrics }, idx) => (
              <TableCell
                key={`${id}-${idx}`}
                className={clsx(
                  ensureAndReturn(metrics[id]).isThreshold &&
                    "power-analysis-cell-threshold",
                  results.weekThreshold === idx + 1 &&
                    "power-analysis-overall-cell-threshold",
                  Object.keys(results.weeks[0]?.metrics).length == pos + 1 &&
                    results.weekThreshold === idx + 1 &&
                    "power-analysis-overall-bottom-threshold",
                )}
              >
                {(() => {
                  const content = percentFormatter(
                    ensureAndReturn(metrics[id]).power,
                  );

                  if (ensureAndReturn(metrics[id]).isThreshold) {
                    const { targetPower } = params;
                    const { effectSize, name } = ensureAndReturn(
                      params.metrics[id],
                    );
                    return (
                      <Tooltip
                        popperClassName="text-top"
                        body={`Week ${
                          idx + 1
                        } is the first week with at least ${percentFormatter(
                          targetPower,
                        )} power to detect an effect size of ${percentFormatter(
                          effectSize,
                          { digits: 1 },
                        )} for ${name}.`}
                        tipPosition="top"
                      >
                        {content}
                      </Tooltip>
                    );
                  }

                  return content;
                })()}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <Box className="appbox p-3">
      <PowerLineGraph
        weeks={results.weeks}
        metrics={params.metrics}
        target={params.targetPower}
        targetLabel={"Target Power"}
        dataType="power"
      />
    </Box>
  </Frame>
);

export default function PowerCalculationContent({
  results,
  params,
  updateVariations,
  updateStatsEngineSettingsWithAlpha,
  edit,
  newCalculation,
}: {
  results: PowerCalculationResults;
  params: PowerCalculationParams;
  updateVariations: (_: number) => void;
  updateStatsEngineSettingsWithAlpha: (_: StatsEngineSettingsWithAlpha) => void;
  edit: () => void;
  newCalculation: () => void;
}) {
  return (
    <div className="contents container pagecontents ml-1 pr-4">
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-space-between align-items-center">
            <h1>Power Calculator</h1>
          </div>
        </div>
      </div>
      <div className="row mb-4">
        <div className="col">
          Select key metrics and hypothesized effect size to determine ideal
          experiment duration.
        </div>
        <div className="col-auto pr-0">
          <Button variant={"outline"} onClick={edit}>
            Edit
          </Button>
        </div>
        <div className="col-auto">
          <Button
            onClick={() => newCalculation()}
            icon={<GBHeadingArrowLeft />}
            ml={"1"}
          >
            New Calculation
          </Button>
        </div>
      </div>
      <AnalysisSettings
        params={params}
        results={results}
        updateVariations={updateVariations}
        updateStatsEngineSettingsWithAlpha={updateStatsEngineSettingsWithAlpha}
      />
      {results.type !== "error" ? (
        <>
          <SampleSizeAndRuntime params={params} results={results} />
          <PowerOverTime params={params} results={results} />
          <MinimumDetectableEffect params={params} results={results} />
        </>
      ) : null}
    </div>
  );
}
const PowerLineGraph = ({
  weeks,
  metrics,
  target,
  targetLabel,
  dataType,
}: {
  weeks: PowerCalculationSuccessResults["weeks"];
  metrics: PowerCalculationParams["metrics"];
  target: number;
  targetLabel: string;
  dataType: "power" | "effectSize";
}) => (
  <Box className="position-relative">
    <ParentSize>
      {({ width }) => (
        <ResponsivePowerLineGraph
          width={width}
          height={300}
          weeks={weeks}
          metrics={metrics}
          target={target}
          targetLabel={targetLabel}
          dataType={dataType}
        />
      )}
    </ParentSize>
  </Box>
);

const ResponsivePowerLineGraph = ({
  width,
  height,
  weeks,
  metrics,
  target,
  targetLabel,
  dataType,
}: {
  width: number;
  height: number;
  weeks: PowerCalculationSuccessResults["weeks"];
  metrics: PowerCalculationParams["metrics"];
  target: number;
  targetLabel: string;
  dataType: "power" | "effectSize";
}) => {
  const margin = { top: 20, right: 160, bottom: 40, left: 60 };
  const legendWidth = 140;
  const legendItemHeight = 20;
  const maxLegendTextWidth = 80;

  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  const metricIds = Object.keys(weeks[0]?.metrics ?? {});
  const data = metricIds.map((id) => ({
    id,
    name: metrics[id].name,
    values: weeks.map((week, idx) => ({
      week: idx + 1,
      value:
        dataType === "power"
          ? week.metrics[id].power * 100
          : week.metrics[id].effectSize * 100,
    })),
  }));

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, weeks.length],
        range: [0, xMax],
      }),
    [xMax, weeks],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [
          0,
          Math.max(
            target * 100,
            Math.max(
              ...weeks.flatMap((week) =>
                Object.values(week.metrics).map((m) =>
                  dataType === "power" ? m.power * 100 : m.effectSize * 100,
                ),
              ),
            ),
          ),
        ],
        range: [yMax, 0],
        nice: true,
      }),
    [yMax, weeks, target, dataType],
  );

  const numYTicks = 5;
  const colors = useMemo(
    () => [
      "var(--blue-9)",
      "var(--jade-9)",
      "var(--orange-9)",
      "var(--plum-9)",
      "var(--red-9)",
      "var(--yellow-9)",
      "var(--cyan-9)",
      "var(--amber-9)",
    ],
    [],
  );

  const {
    showTooltip,
    hideTooltip,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<{
    week: number;
    values: { name: string; value: number; color: string }[];
  }>();

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const point = localPoint(event.currentTarget, event);
      if (!point) return;

      const x = point.x - margin.left;
      const weekX = Math.round(xScale.invert(x));
      if (weekX < 1 || weekX > weeks.length) return;

      const tooltipValues = data.map((metric, i) => ({
        name: metric.name,
        value: metric.values[weekX - 1].value,
        color: colors[i % colors.length],
      }));

      showTooltip({
        tooltipData: {
          week: weekX,
          values: tooltipValues,
        },
        tooltipLeft: point.x,
        tooltipTop: point.y,
      });
    },
    [margin.left, xScale, data, showTooltip, colors, weeks.length],
  );

  return (
    <>
      <svg
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={hideTooltip}
      >
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={xMax}
            strokeDasharray="2,2"
            stroke="var(--slate-6)"
            strokeOpacity={0.3}
            numTicks={numYTicks}
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(target * 100)}
            y2={yScale(target * 100)}
            stroke="var(--slate-11)"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          <AxisBottom
            top={yMax}
            scale={xScale}
            tickFormat={(week) => `${week}`}
            label="Week"
            labelProps={{
              fill: "var(--slate-12)",
              fontSize: 12,
              textAnchor: "middle",
            }}
            tickLabelProps={() => ({
              fill: "var(--slate-11)",
              fontSize: 11,
              textAnchor: "middle",
              dy: "0.25em",
            })}
            stroke="var(--slate-11)"
            tickStroke="var(--slate-11)"
          />
          <AxisLeft
            scale={yScale}
            numTicks={numYTicks}
            tickFormat={(value) => `${value}%`}
            label={dataType === "power" ? "Power" : "Minimum Detectable Effect"}
            labelProps={{
              fill: "var(--slate-12)",
              fontSize: 12,
              textAnchor: "middle",
            }}
            tickLabelProps={() => ({
              fill: "var(--slate-11)",
              fontSize: 11,
              textAnchor: "end",
              dx: "-0.25em",
              dy: "0.25em",
            })}
            stroke="var(--slate-11)"
            tickStroke="var(--slate-11)"
          />
          {data.map((metric, i) => (
            <LinePath
              key={metric.id}
              data={metric.values}
              x={(d) => xScale(d.week) ?? 0}
              y={(d) => yScale(d.value)}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          ))}

          <rect
            x={xMax + 20}
            y={-2}
            width={legendWidth}
            height={data
              .map(
                (m) =>
                  (Math.max(Math.ceil(m.name.length / 15), 1) + 1) *
                  legendItemHeight,
              )
              .reduce((ps, a) => ps + a, 0)}
            fill="var(--slate-a2)"
            stroke="var(--slate-a6)"
            strokeWidth={1}
            rx={4}
          />

          <g transform={`translate(0, ${legendItemHeight / 2})`}>
            <line
              x1={xMax + 30}
              x2={xMax + 50}
              y1={0}
              y2={0}
              stroke="var(--slate-11)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <text
              x={xMax + 60}
              y={0}
              fill="var(--slate-11)"
              fontSize={11}
              dy=".3em"
            >
              {targetLabel}
            </text>
          </g>

          {data.map((metric, i) => (
            <g
              key={metric.id}
              transform={`translate(0, ${(i + 1) * legendItemHeight + 5})`}
            >
              <line
                x1={xMax + 30}
                x2={xMax + 50}
                y1={legendItemHeight / 3}
                y2={legendItemHeight / 3}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
              />
              <foreignObject
                x={xMax + 60}
                y={0}
                width={maxLegendTextWidth}
                height={
                  Math.max(Math.ceil(metric.name.length / 15), 1) *
                  legendItemHeight
                }
              >
                <div
                  style={{
                    color: colors[i % colors.length],
                    fontSize: "11px",
                    lineHeight: "1.2",
                    wordWrap: "break-word",
                  }}
                >
                  {metric.name}
                </div>
              </foreignObject>
            </g>
          ))}
        </Group>
      </svg>

      {tooltipData && (
        <VisxTooltip
          left={tooltipLeft + 10}
          top={tooltipTop + 10}
          style={{
            ...defaultStyles,
            backgroundColor: "var(--slate-3)",
            border: "1px solid var(--slate-6)",
            color: "var(--slate-12)",
            position: "absolute",
          }}
        >
          <div className="text-sm">
            <strong>Week {tooltipData.week}</strong>
            {tooltipData.values.map((v, i) => (
              <div key={i} style={{ color: v.color }}>
                {v.name}: {v.value.toFixed(1)}%
              </div>
            ))}
          </div>
        </VisxTooltip>
      )}
    </>
  );
};
