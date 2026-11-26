import React, { useState } from "react";
import Handlebars from "handlebars";
import { PiNote } from "react-icons/pi";
import clsx from "clsx";
import { useLingui } from "@lingui/react/macro";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
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
}

const CustomMarkdown: React.FC<Props> = ({ page, variables }) => {
  const { t } = useLingui();
  const { name, organization, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const settingName = PAGE_TO_SETTING_NAME[page];
  const markdown = settings[settingName];
  const [showModal, setShowModal] = useState(false);

  if (!markdown || !hasCommercialFeature("custom-markdown")) return null;

  const baseVariables = {
    user: name,
    orgName: organization.name,
  };

  const template = Handlebars.compile(markdown);
  const renderedMarkdown = template({ ...baseVariables, ...variables });

  const orgName = organization.name;
  const pageToCta = {
    experiment: t`How to run an experiment at ${orgName}`,
    experimentList: t`How to prepare an experiment at ${orgName}`,
    feature: t`How to configure a feature flag at ${orgName}`,
    featureList: t`How to create a feature flag at ${orgName}`,
    metric: t`How to create a metric at ${orgName}`,
    metricList: t`How to create a metric at ${orgName}`,
  };

  return (
    <>
      {showModal && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header={pageToCta[page]}
          close={() => setShowModal(false)}
          size="lg"
        >
          <Markdown>{renderedMarkdown}</Markdown>
        </ModalStandard>
      )}

      <div className={clsx(styles.customMarkdown, "appbox p-4")}>
        <PiNote className="mr-2" style={{ height: "20px", width: "20px" }} />
        <a role="button" onClick={() => setShowModal(true)}>
          <strong>{pageToCta[page]}</strong>
        </a>
      </div>
    </>
  );
};

export default CustomMarkdown;
