import React, { useState } from "react";
import Handlebars from "handlebars";
import { PiNote } from "react-icons/pi";
import clsx from "clsx";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
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

  return (
    <>
      {showModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header={<h4>{PAGE_TO_CTA[page] + organization.name}</h4>}
          close={() => setShowModal(false)}
          closeCta="Close"
          size="lg"
        >
          <Markdown>{renderedMarkdown}</Markdown>
        </Modal>
      )}

      <div className={clsx(styles.customMarkdown, "appbox p-4")}>
        <PiNote className="mr-2" style={{ height: "20px", width: "20px" }} />
        <a role="button" onClick={() => setShowModal(true)}>
          <strong>{PAGE_TO_CTA[page] + organization.name}</strong>
        </a>
      </div>
    </>
  );
};

export default CustomMarkdown;
