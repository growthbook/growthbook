import React from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { AppFeatures } from "@/types/app-features";
import { useUser } from "@/services/UserContext";
import ActivityList from "@/components/ActivityList";
import ExperimentList from "@/components/Experiment/ExperimentList";
import ExperimentGraph from "@/components/Experiment/ExperimentGraph";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ExecReport from "@/components/ExecReports/ExecReport";
import Link from "@/ui/Link";
import styles from "./Dashboard.module.scss";
import IdeasFeed from "./IdeasFeed";
import NorthStar from "./NorthStar";
import ExperimentImpact from "./ExperimentImpact";

export interface Props {
  experiments: ExperimentInterfaceStringDates[];
}

export default function Dashboard({ experiments }: Props) {
  const { name, hasCommercialFeature } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();

  const nameMap = new Map<string, string>();
  experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  const experimentImpactWidget = (
    <div className="col-xl-13 mb-4">
      <div className="list-group activity-box overflow-auto pt-1">
        {hasCommercialFeature("experiment-impact") ? (
          <ExperimentImpact experiments={experiments} />
        ) : (
          <div className="pt-2">
            <div className="row align-items-start mb-4">
              <div className="col-lg-auto">
                <h3 className="mt-2">Experiment Impact</h3>
              </div>
            </div>

            <PremiumTooltip commercialFeature="experiment-impact">
              Experiment Impact is available to Enterprise customers
            </PremiumTooltip>
          </div>
        )}
      </div>
    </div>
  );

  const showImpactNearTop = growthbook.isOn("show-impact-near-top");

  const newExecReports = growthbook.isOn("new-exec-reports");

  return (
    <>
      {newExecReports ? (
        <div className={"container-fluid dashboard p-3 " + styles.container}>
          <ExecReport />
        </div>
      ) : (
        <div className={"container-fluid dashboard p-3 " + styles.container}>
          <h1>Hello {name}</h1>
          <div className="row">
            <div className="col-md-12">
              <NorthStar experiments={experiments} />
            </div>
          </div>

          {showImpactNearTop ? experimentImpactWidget : null}
          <div className="row">
            <div className="col-lg-12 col-md-12 col-xl-8 mb-3">
              <div className="list-group activity-box">
                <ExperimentGraph
                  resolution={"month"}
                  num={12}
                  height={220}
                  initialShowBy={"all"}
                />
              </div>
            </div>
            <div className="col-md-4 mb-3">
              <div className="list-group activity-box fixed-height overflow-auto">
                <h4 className="">
                  Recent Activity{" "}
                  <Link href="/activity" className="float-right h6">
                    See all
                  </Link>
                </h4>
                <ActivityList num={3} />
              </div>
            </div>
            <div className="col-md-4 col-xl-6 mb-4">
              <div className="list-group activity-box fixed-height overflow-auto">
                <h4>
                  Running Experiments
                  <Link href={`/experiments`} className="float-right h6">
                    See all
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
                  <Link href={`/ideas`} className="float-right h6">
                    See all
                  </Link>
                </h4>
                <IdeasFeed num={5} />
              </div>
            </div>
          </div>
          {!showImpactNearTop ? experimentImpactWidget : null}
        </div>
      )}
    </>
  );
}
