import React from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import ExecReport from "@/components/ExecReports/ExecReport";
import styles from "./Dashboard.module.scss";
export interface Props {
  experiments: ExperimentInterfaceStringDates[];
}

export default function Dashboard({ experiments }: Props) {
  const nameMap = new Map<string, string>();
  experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  return (
    <>
      {/* PROTOTYPE (set in review): no padding of its own on the left and
        right (was p-3's 16px, on top of the page's), so the report starts
        at the app-wide page padding's 32px (global.scss); 16px above and
        below, as before. */}
      <div
        className={"container-fluid dashboard py-3 px-0 " + styles.container}
      >
        <ExecReport />
      </div>
    </>
  );
}
