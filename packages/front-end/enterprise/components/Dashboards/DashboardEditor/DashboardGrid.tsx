import React, { useMemo } from "react";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DASHBOARD_GRID_ROW_HEIGHT_DEFAULT,
} from "shared/enterprise";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import {
  buildRGLLayout,
  getGridKeyForBlock,
  DASHBOARD_GRID_MARGIN,
} from "./dashboardLayout";
import {
  RGL_BREAKPOINTS,
  RGL_COLS,
  RGL_CANONICAL_BREAKPOINT,
  CANONICAL_COL_BREAKPOINTS,
} from "./dashboardGridConfig";

export default function DashboardGrid({
  blocks,
  renderBlock,
}: {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  renderBlock: (
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
    index: number,
  ) => React.ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1280,
  });
  const layouts = useMemo(() => {
    const layout = buildRGLLayout(blocks, RGL_COLS[RGL_CANONICAL_BREAKPOINT]);
    return Object.fromEntries(
      CANONICAL_COL_BREAKPOINTS.map((bp) => [bp, layout]),
    );
  }, [blocks]);
  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="dashboard-grid-container"
    >
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          className="dashboard-grid"
          layouts={layouts}
          breakpoints={RGL_BREAKPOINTS}
          cols={RGL_COLS}
          rowHeight={DASHBOARD_GRID_ROW_HEIGHT_DEFAULT}
          margin={[DASHBOARD_GRID_MARGIN, DASHBOARD_GRID_MARGIN]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: false }}
          resizeConfig={{ enabled: false }}
          compactor={verticalCompactor}
        >
          {blocks.map((block, i) => (
            <div
              key={getGridKeyForBlock(block, i)}
              className="dashboard-grid-item"
            >
              {renderBlock(block, i)}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
