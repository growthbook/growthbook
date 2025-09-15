import React from "react";
import { NextPage } from "next";
import { useGrowthBook } from "@growthbook/growthbook-react";
import ImportFromStatsig from "@/components/importing/ImportFromStatsig/ImportFromStatsig";
import { AppFeatures } from "@/types/app-features";
import Avatar from "@/components/Radix/Avatar";

const ImportFromStatsigPage: NextPage = () => {
  const growthbook = useGrowthBook<AppFeatures>();
  const isStatsigImportEnabled = growthbook?.isOn("import-from-s");

  // Show painted door if feature is disabled
  if (!isStatsigImportEnabled) {
    return (
      <div className="contents container pagecontents">
        <div className="row">
          <div className="col-md-8 mx-auto">
            <div className="card">
              <div className="card-body text-center p-5">
                <h2 className="mb-3">
                  <Avatar size="lg" color="gray" mr="2">
                    <img src="/images/3rd-party-logos/importing/icons/statsig.svg" />
                  </Avatar>
                  Import from Statsig
                </h2>
                <p className="mt-5 mb-3">
                  Our Statsig importer is in closed beta. To unlock this
                  feature, please contact our sales team.
                </p>
                <p>Please contact sales@growthbook.io learn more.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="contents container pagecontents">
      <ImportFromStatsig />
    </div>
  );
};

export default ImportFromStatsigPage;
