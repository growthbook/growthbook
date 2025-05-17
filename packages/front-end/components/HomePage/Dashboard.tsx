import React from "react";
import ExecReport from "@/components/ExecReports/ExecReport";
import styles from "./Dashboard.module.scss";

export default function Dashboard() {
  return (
    <>
      <div className={"container-fluid dashboard p-3 " + styles.container}>
        <ExecReport />
      </div>
    </>
  );
}
