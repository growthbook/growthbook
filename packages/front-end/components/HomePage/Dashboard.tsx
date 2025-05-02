import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import ExecReport from "@/components/ExecReports/ExecReport";
import styles from "./Dashboard.module.scss";

export interface Props {
  experiments: ExperimentInterfaceStringDates[];
}

export default function Dashboard({ experiments }: Props) {

  return (
    <>
      <div className={"container-fluid dashboard p-3 " + styles.container}>
        <ExecReport />
      </div>
    </>
  );
}
