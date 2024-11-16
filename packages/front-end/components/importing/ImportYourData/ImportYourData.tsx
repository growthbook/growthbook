import React, { FC } from "react";
import { ImportFromServiceCard } from "@/components/importing/ImportFromServiceCard/ImportFromServiceCard";

type ImportYourDataProps = Record<string, never>;

const supportedServices = [
  {
    service: "LaunchDarkly",
    icon: "launchdarkly",
    path: "launchdarkly",
    accentColor: "#000",
    text: "从LaunchDarkly导入您的项目、Feature和环境。",
  },
];

export const ImportYourData: FC<ImportYourDataProps> = (_props) => {
  return (
    <div>
      <h1>导入您的数据</h1>

      {supportedServices.map(({ service, icon, path, accentColor, text }) => (
        <div key={`ImportFromServiceCard-${service}`} className="my-3">
          <ImportFromServiceCard
            service={service}
            icon={icon}
            path={path}
            accentColor={accentColor}
          >
            {text}
          </ImportFromServiceCard>
        </div>
      ))}
    </div>
  );
};
