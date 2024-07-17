import React from "react";
import Handlebars from "handlebars";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Markdown from "./Markdown";

const PAGE_TO_SETTING_NAME = {
  experiment: "experimentPageMarkdown",
  experimentList: "experimentListMarkdown",
  feature: "featurePageMarkdown",
  featureList: "featureListMarkdown",
  metric: "metricPageMarkdown",
  metricList: "metricListMarkdown",
};

interface Props {
  page:
    | "experiment"
    | "experimentList"
    | "feature"
    | "featureList"
    | "metric"
    | "metricList";
  variables?: Record<string, unknown>;
}

const CustomMarkdown: React.FC<Props> = ({ page, variables }) => {
  const { name, organization, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const settingName = PAGE_TO_SETTING_NAME[page];
  const markdown = settings[settingName];

  if (!markdown || !hasCommercialFeature("custom-markdown")) return null;

  const baseVariables = {
    user: name,
    orgName: organization.name,
  };

  const template = Handlebars.compile(markdown);
  const renderedMarkdown = template({ ...baseVariables, ...variables });

  return (
    <div
      className="alert alert-info"
      style={{ maxHeight: "100px", overflowY: "auto" }}
    >
      <Markdown>{renderedMarkdown}</Markdown>
    </div>
  );
};

export default CustomMarkdown;
