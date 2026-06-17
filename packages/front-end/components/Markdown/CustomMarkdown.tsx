import React from "react";
import Handlebars from "handlebars";
import { PiNote } from "react-icons/pi";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import ExpandableContent from "@/ui/ExpandableContent";
import Markdown from "./Markdown";
import styles from "./CustomMarkdown.module.scss";

const PAGE_TO_SETTING_NAME = {
  experiment: "experimentPageMarkdown",
  experimentList: "experimentListMarkdown",
  feature: "featurePageMarkdown",
  featureList: "featureListMarkdown",
  metric: "metricPageMarkdown",
  metricList: "metricListMarkdown",
};

const PAGE_TO_CTA = {
  experiment: "How to run an experiment at ",
  experimentList: "How to prepare an experiment at ",
  feature: "How to configure a feature flag at ",
  featureList: "How to create a feature flag at ",
  metric: "How to create a metric at ",
  metricList: "How to create a metric at ",
};

const DEFAULT_MAX_HEIGHT = 150;

interface Props {
  page:
    | "experiment"
    | "experimentList"
    | "feature"
    | "featureList"
    | "metric"
    | "metricList"
    | "learnings";
  variables?: Record<string, unknown>;
  maxHeight?: number;
}

const CustomMarkdown: React.FC<Props> = ({
  page,
  variables,
  maxHeight = DEFAULT_MAX_HEIGHT,
}) => {
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
    <div className={clsx(styles.customMarkdown, "appbox p-4")}>
      <div className={styles.header}>
        <PiNote className="mr-2" style={{ height: "20px", width: "20px" }} />
        <strong>{PAGE_TO_CTA[page] + organization.name}</strong>
      </div>
      <div className={styles.content}>
        <ExpandableContent maxHeight={maxHeight}>
          <Markdown>{renderedMarkdown}</Markdown>
        </ExpandableContent>
      </div>
    </div>
  );
};

export default CustomMarkdown;
