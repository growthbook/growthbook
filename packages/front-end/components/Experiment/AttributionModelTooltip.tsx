import { ReactNode } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";

export function AttributionModelTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <div>
          <div className="mb-2">
            用于确定我们是否遵循转化窗口（通过这种方式无法覆盖回溯窗口）。
          </div>
          <div className="mb-2">
            <strong>遵循转化窗口</strong> - 针对具有转化窗口的指标，根据每个用户的首次曝光构建单个转化窗口。
          </div>
          <div>
            <strong>忽略转化窗口</strong> - 覆盖所有指标的转化窗口，并统计从用户首次曝光到实验结束的所有指标值。
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}
