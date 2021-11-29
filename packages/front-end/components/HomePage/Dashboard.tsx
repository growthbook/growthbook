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
import IdeasFeed from "./IdeasFeed";

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
          <div className="col-lg-12 col-md-12 col-xl-8 mb-3">
            <div className="list-group activity-box fixed-height overflow-auto">
              <h4 className="mb-3">Experiments by month</h4>
              <ExperimentGraph
                resolution={"month"}
                num={12}
                status={"all"}
                height={220}
              />
            </div>
          </div>
          <div className="col-xl-4 col-md-6 mb-3">
            <div className="list-group activity-box fixed-height overflow-auto">
              <h4>
                Running Experiments
                <Link href={`/experiments`}>
                  <a className="float-right h6">See all</a>
                </Link>
              </h4>
              <ExperimentList num={5} status={"running"} />
            </div>
          </div>
          <div className="col-xl-4 col-md-6 mb-3">
            <div className="list-group activity-box fixed-height overflow-auto ">
              <h4>
                Recent Ideas{" "}
                <Link href={`/ideas`}>
                  <a className="float-right h6">See all</a>
                </Link>
              </h4>
              <IdeasFeed num={5} />
            </div>
          </div>
          <div className="col-xl-4 col-md-6 mb-3">
            <div className="list-group activity-box fixed-height overflow-auto">
              <h4 className="mb-3">Recent discussions</h4>
              <DiscussionFeed num={5} />
            </div>
          </div>
          <div className="col-xl-4 col-md-6 mb-4">
            <div className="list-group activity-box fixed-height overflow-auto">
              <h4 className="">
                Recent activity{" "}
                <Link href="/activity">
                  <a className="float-right h6">See all</a>
                </Link>
              </h4>
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
