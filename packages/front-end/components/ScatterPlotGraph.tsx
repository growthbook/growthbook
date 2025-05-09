import React from 'react';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleLinear, scaleLog } from '@visx/scale';
import { Line } from '@visx/shape';
import { useTooltip, TooltipWithBounds, defaultStyles as tooltipDefaultStyles } from '@visx/tooltip';
import { GlyphCircle } from '@visx/glyph';
// ParentSize can be useful for responsive charts, but not strictly needed for the component logic itself.
// import { ParentSize } from '@visx/responsive';

export interface ScatterPointData {
  y: number;
  x: number;
  ymin: number;
  ymax: number;
  xmin: number;
  xmax: number;
  units: number;
  experimentName: string;
  variationName: string;
  xMetricName: string;
  yMetricName: string;
  id: string; // For unique key, e.g., index or a unique identifier from data source
}

export interface ScatterPlotGraphProps {
  data: ScatterPointData[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
}

const defaultMargin = { top: 40, right: 50, bottom: 50, left: 60 };

const ScatterPlotGraph: React.FC<ScatterPlotGraphProps> = ({
  data,
  width,
  height,
  margin = defaultMargin,
}) => {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<ScatterPointData>();

  if (width < 10 || height < 10 || data.length === 0) return null;

  // Inner dimensions
  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  // Scales
  const allXValues = data.flatMap(d => [d.x, d.xmin, d.xmax]);
  const allYValues = data.flatMap(d => [d.y, d.ymin, d.ymax]);
  const allUnits = data.map(d => d.units).filter(u => isFinite(u));

  const xScale = scaleLinear<number>({
    domain: [Math.min(...allXValues), Math.max(...allXValues)],
    range: [0, xMax],
    nice: true,
  });

  const yScale = scaleLinear<number>({
    domain: [Math.min(...allYValues), Math.max(...allYValues)],
    range: [yMax, 0],
    nice: true,
  });

  const sizeScale = scaleLog<number>({
    domain: allUnits.length > 0 ? [Math.min(...allUnits), Math.max(...allUnits)] : [0,1], // Handle empty or single-value units
    range: [5, 15], // Min and max radius for points
  });

  // Accessors
  const getX = (d: ScatterPointData) => d.x;
  const getY = (d: ScatterPointData) => d.y;

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <rect x={0} y={0} width={width} height={height} fill="transparent" rx={14} />
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={yScale} width={xMax} height={yMax} stroke="#e0e0e0" strokeDasharray="2,2" />
          <GridColumns scale={xScale} width={xMax} height={yMax} stroke="#e0e0e0" strokeDasharray="2,2" />
          
          {/* Zero line for Y-axis (horizontal) */}
          {yScale.domain()[0] <= 0 && yScale.domain()[1] >= 0 && (
            <Line
              from={{ x: 0, y: yScale(0) }}
              to={{ x: xMax, y: yScale(0) }}
              stroke="#d0d0d0" // Darker than grid lines
              strokeWidth={1.5}
            />
          )}

          {/* Zero line for X-axis (vertical) */}
          {xScale.domain()[0] <= 0 && xScale.domain()[1] >= 0 && (
            <Line
              from={{ x: xScale(0), y: 0 }}
              to={{ x: xScale(0), y: yMax }}
              stroke="#d0d0d0" // Darker than grid lines
              strokeWidth={1.5}
            />
          )}
          
          <AxisLeft scale={yScale} label={data[0]?.yMetricName || 'Y Value'} labelClassName="h4" tickLabelProps={() => ({
            fill: "var(--text-color-table)",
            fontSize: 14,
            textAnchor: "end",
            verticalAnchor: "middle",
          })} />
          <AxisBottom scale={xScale} top={yMax} label={data[0]?.xMetricName || 'X Value'} labelClassName="h4" tickLabelProps={() => ({
            fill: "var(--text-color-table)",
            fontSize: 14,
            textAnchor: "middle",})} />

          {data.map((point) => {
            const cx = xScale(getX(point));
            const cy = yScale(getY(point));
            // Ensure units is a valid number for sizeScale
            const pointUnits = isFinite(point.units) ? point.units : 0;
            const radius = sizeScale(pointUnits);

            // Error bars coordinates
            const xMinCoord = xScale(point.xmin);
            const xMaxCoord = xScale(point.xmax);
            const yMinCoord = yScale(point.ymin);
            const yMaxCoord = yScale(point.ymax);

            return (
              <React.Fragment key={`point-group-${point.id}`}>
                {/* X Error Bar */}
                <Line
                  from={{ x: xMinCoord, y: cy }}
                  to={{ x: xMaxCoord, y: cy }}
                  stroke="#777"
                  strokeWidth={1.5}
                />
                {/* Y Error Bar */}
                <Line
                  from={{ x: cx, y: yMinCoord }}
                  to={{ x: cx, y: yMaxCoord }}
                  stroke="#777"
                  strokeWidth={1.5}
                />
                <GlyphCircle
                  left={cx}
                  top={cy}
                  size={radius * radius * Math.PI} // GlyphCircle size is area
                  fill="#1f77b4" // A common blue color
                  stroke="#fff" // White border for better visibility
                  strokeWidth={1}
                  onPointerMove={(event) => {
                    // clientX/Y are viewport coords, adjust if SVG is offset in page
                    // For TooltipInPortal, often direct clientX/Y is fine.
                    // For TooltipWithBounds, we want coordinates relative to the graph's plottable area (cx, cy)
                    showTooltip({
                      tooltipData: point,
                      tooltipLeft: cx, // Use cx (relative to Group)
                      tooltipTop: cy,  // Use cy (relative to Group)
                    });
                  }}
                  onPointerLeave={hideTooltip}
                  style={{ cursor: 'pointer' }}
                />
              </React.Fragment>
            );
          })}
        </Group>
      </svg>
      {tooltipOpen && tooltipData && tooltipLeft != null && tooltipTop != null && (
        <TooltipWithBounds
          // key={Math.random()} // Removed, usually not needed if props change correctly
          top={tooltipTop + margin.top}   // Add margin.top for correct positioning relative to the outer div
          left={tooltipLeft + margin.left} // Add margin.left for correct positioning relative to the outer div
          style={{
            ...tooltipDefaultStyles,
            backgroundColor: 'rgba(50,50,50,0.9)',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            fontSize: '13px',
            lineHeight: '1.5',
            boxShadow: '0px 2px 10px rgba(0,0,0,0.2)',
            pointerEvents: 'none', 
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{tooltipData.experimentName} - {tooltipData.variationName}</div>
          <div>
            <strong>{tooltipData.yMetricName}:</strong> {tooltipData.y.toFixed(2)}
          </div>
           <div style={{fontSize: '11px', color: '#ccc'}}>
            (CI: {tooltipData.ymin.toFixed(2)} - {tooltipData.ymax.toFixed(2)})
          </div>
          <div style={{marginTop: '4px'}}>
            <strong>{tooltipData.xMetricName}:</strong> {tooltipData.x.toFixed(2)}
          </div>
          <div style={{fontSize: '11px', color: '#ccc'}}>
            (CI: {tooltipData.xmin.toFixed(2)} - {tooltipData.xmax.toFixed(2)})
          </div>
          <div style={{marginTop: '4px'}}><strong>Units:</strong> {tooltipData.units.toLocaleString()}</div>
        </TooltipWithBounds>
      )}
    </div>
  );
};

export default ScatterPlotGraph;

// Example usage (remove or keep for testing, typically used with ParentSize for responsiveness):
/*
import { ParentSize } from '@visx/responsive';

const SampleScatterData: ScatterPointData[] = [
  { id: 'exp1', y: 25, x: 100, ymin: 22, ymax: 28, xmin: 90, xmax: 110, units: 1500, experimentName: 'Experiment Alpha', yMetricName: 'Avg. Order Value', xMetricName: 'Ad Spend' },
  { id: 'exp2', y: 30, x: 120, ymin: 27, ymax: 33, xmin: 110, xmax: 130, units: 2200, experimentName: 'Experiment Beta', yMetricName: 'Avg. Order Value', xMetricName: 'Ad Spend' },
  { id: 'exp3', y: 20, x: 80, ymin: 18, ymax: 22, xmin: 75, xmax: 85, units: 900, experimentName: 'Experiment Gamma', yMetricName: 'Avg. Order Value', xMetricName: 'Ad Spend' },
  { id: 'exp4', y: 35, x: 150, ymin: 32, ymax: 38, xmin: 140, xmax: 160, units: 3000, experimentName: 'Experiment Delta', yMetricName: 'Avg. Order Value', xMetricName: 'Ad Spend' },
];

const App = () => (
  <div style={{ width: '100%', height: '500px', border: '1px solid #ccc' }}>
    <ParentSize>
      {({ width, height }) => (
        <ScatterPlotGraph data={SampleScatterData} width={width} height={height} />
      )}
    </ParentSize>
  </div>
);

// You would render <App /> in your main application file.
*/ 