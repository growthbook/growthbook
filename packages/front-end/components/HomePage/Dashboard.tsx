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
      {/* PROTOTYPE (set in review): no padding of its own (was p-3's 16px,
        on top of the page's), so the report sits in the app-wide page
        frame (global.scss). */}
      <div className={"container-fluid dashboard p-0 " + styles.container}>
        <ExecReport />
      </div>
    </>
  );
}
