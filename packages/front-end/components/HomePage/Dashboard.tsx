import React, { FC, useContext } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import Link from "next/link";
import ActivityList from "../ActivityList";
import DiscussionFeed from "./DiscussionFeed";
import styles from "./Dashboard.module.scss";
import ExperimentList from "../Experiment/ExperimentList";
import ExperimentGraph from "../Experiment/ExperimentGraph";
import { UserContext } from "../ProtectedPage";

const Dashboard: FC = () => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  const { name } = useContext(UserContext);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  return (
    <>
      <div className={"container-fluid dashboard p-3 " + styles.container}>
        <h1>Hello {name}</h1>
        <div className="row">
          <div className="col-md-12">
            <h4>Experiments by month</h4>
            <div className="list-group activity-box overflow-auto mb-4">
              <ExperimentGraph
                resolution={"month"}
                num={12}
                status={"all"}
                height={200}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-lg-4 mb-4">
            <h4>Running Experiments</h4>
            <div className="list-group activity-box fixed-height overflow-auto mb-4">
              <ExperimentList num={5} status={"stopped"} />
            </div>
          </div>
          <div className="col-lg-4 mb-4">
            <h4>Recent discussions</h4>
            <div className="list-group activity-box fixed-height overflow-auto mb-2">
              <DiscussionFeed num={5} />
            </div>
          </div>
          <div className="col-lg-4 mb-4">
            <h4 className="">
              Recent activity{" "}
              <small>
                <Link href="/activity">
                  <a className="small">(See all activity)</a>
                </Link>
              </small>
            </h4>
            <div className="list-group activity-box fixed-height overflow-auto">
              <ActivityList num={3} />
            </div>
            <div className="text-center"></div>
          </div>
        </div>
      </div>
    </>
  );
};
export default Dashboard;
