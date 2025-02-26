import React from "react";
import Link from "next/link";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { AppFeatures } from "@/types/app-features";
import { useUser } from "@/services/UserContext";
import ActivityList from "@/components/ActivityList";
import ExperimentList from "@/components/Experiment/ExperimentList";
import ExperimentGraph from "@/components/Experiment/ExperimentGraph";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Frame from "@/components/Radix/Frame";
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
      <Frame className="overflow-auto">
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
      </Frame>
    </div>
  );

  const showImpactNearTop = growthbook.isOn("show-impact-near-top");

  return (
    <>
      <div className={"container-fluid dashboard p-3 " + styles.container}>
        <h1>Hello {name}</h1>
        <div className="row">
          <div className="col-md-12">
            <NorthStar experiments={experiments} />
          </div>
        </div>

        {showImpactNearTop ? experimentImpactWidget : null}
        <div className="row">
          <div className="col-lg-12 col-md-12 col-xl-8">
            <Frame className="fixed-height" height="100%">
              <ExperimentGraph
                resolution={"month"}
                num={12}
                height={220}
                initialShowBy={"all"}
              />
            </Frame>
          </div>
          <div className="col-md-4">
            <Frame className="overflow-auto fixed-height" height="100%">
              <h4 className="">
                Recent Activity{" "}
                <Link href="/activity" className="float-right h6">
                  See all
                </Link>
              </h4>
              <ActivityList num={3} />
            </Frame>
          </div>
          <div className="col-md-4 col-xl-6">
            <Frame className="overflow-auto fixed-height" height="100%">
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
            </Frame>
          </div>
          <div className="col-md-4 col-xl-6">
            <Frame className="overflow-auto fixed-height" height="100%">
              <h4>
                Recent Ideas{" "}
                <Link href={`/ideas`} className="float-right h6">
                  See all
                </Link>
              </h4>
              <IdeasFeed num={5} />
            </Frame>
          </div>
        </div>
        {!showImpactNearTop ? experimentImpactWidget : null}
      </div>
    </>
  );
}
