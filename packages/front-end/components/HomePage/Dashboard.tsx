import React, { useState } from "react";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import ActivityList from "../ActivityList";
import ExperimentList from "../Experiment/ExperimentList";
import ExperimentGraph from "../Experiment/ExperimentGraph";
import styles from "./Dashboard.module.scss";
import IdeasFeed from "./IdeasFeed";
import NorthStar from "./NorthStar";

export interface Props {
  experiments: ExperimentInterfaceStringDates[];
}

export default function Dashboard({ experiments }: Props) {
  const { name } = useUser();
  const [showBy, setShowBy] = useState<"status" | "project" | "all" | "user">(
    "all"
  );

  const nameMap = new Map<string, string>();
  experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  return (
    <>
      <div className={"container-fluid dashboard p-3 " + styles.container}>
        <h1>Hello {name}</h1>
        <div className="row">
          <div className="col-md-12">
            <NorthStar experiments={experiments} />
          </div>
        </div>
        <div className="row">
          <div className="col-lg-12 col-md-12 col-xl-8 mb-3">
            <div className="list-group activity-box fixed-height overflow-auto">
              <div className="row mb-3 align-content-end">
                <div className="col">
                  <h4 className="mb-0">Experiments by month</h4>
                </div>
                <div className="col-auto small">
                  Show:
                  <Field
                    containerClassName="d-inline-block ml-2 mb-0 small"
                    options={[
                      {
                        value: "all",
                        display: "All experiments",
                      },
                      {
                        value: "status",
                        display: "By status",
                      },
                      {
                        value: "project",
                        display: "By projects",
                      },
                    ]}
                    value={showBy}
                    onChange={(e) => {
                      if (
                        e.target.value === "user" ||
                        e.target.value === "all" ||
                        e.target.value === "project" ||
                        e.target.value === "status"
                      ) {
                        setShowBy(e.target.value);
                      }
                    }}
                  />
                </div>
              </div>
              <ExperimentGraph
                resolution={"month"}
                num={12}
                status={"all"}
                height={220}
                showBy={showBy}
              />
            </div>
          </div>
          <div className="col-md-4 mb-3">
            <div className="list-group activity-box fixed-height overflow-auto">
              <h4 className="">
                Recent Activity{" "}
                <Link href="/activity">
                  <a className="float-right h6">See all</a>
                </Link>
              </h4>
              <ActivityList num={3} />
            </div>
          </div>
          <div className="col-md-4 col-xl-6 mb-4">
            <div className="list-group activity-box fixed-height overflow-auto">
              <h4>
                Running Experiments
                <Link href={`/experiments`}>
                  <a className="float-right h6">See all</a>
                </Link>
              </h4>
              <ExperimentList
                num={5}
                status={"running"}
                experiments={experiments}
              />
            </div>
          </div>
          <div className="col-md-4 col-xl-6 mb-3">
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
        </div>
      </div>
    </>
  );
}
