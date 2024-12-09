import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import Collapsible from "react-collapsible";

export default function ConfigureReport({
  report,
  mutate,
  open,
  setOpen,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate: () => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  return (
    <div className="bg-white">
      <Collapsible
        // @ts-expect-error - state managed by external button
        trigger={null}
        open={open}
        transitionTime={100}
      >
        <div
          className="border border-bottom-0 py-2 px-3"
          style={{
            backgroundColor: "var(--iris-a3)",
            boxShadow: "0 -6px 8px -4px #00000011 inset",
          }}
        >
          <div className="h4 mt-1">Configuration</div>
        </div>
      </Collapsible>
    </div>
  );
}
