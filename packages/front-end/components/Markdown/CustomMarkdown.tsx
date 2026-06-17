import Handlebars from "handlebars";
import clsx from "clsx";
import { useMemo } from "react";
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
} as const;

export type CustomMarkdownPage = keyof typeof PAGE_TO_SETTING_NAME;

const DEFAULT_MAX_HEIGHT = 100;

interface Props {
  page: CustomMarkdownPage;
  variables?: Record<string, unknown>;
  maxHeight?: number;
}

export default function CustomMarkdown({
  page,
  variables,
  maxHeight = DEFAULT_MAX_HEIGHT,
}: Props) {
  const { name, organization, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const markdown = settings[PAGE_TO_SETTING_NAME[page]];

  const renderedMarkdown = useMemo(() => {
    if (!markdown) return null;
    const template = Handlebars.compile(markdown);
    return template({
      user: name,
      orgName: organization.name,
      ...variables,
    });
  }, [markdown, name, organization.name, variables]);

  if (!renderedMarkdown || !hasCommercialFeature("custom-markdown")) {
    return null;
  }

  return (
    <div className={clsx("appbox p-4", styles.customMarkdown)}>
      <ExpandableContent maxHeight={maxHeight}>
        <Markdown>{renderedMarkdown}</Markdown>
      </ExpandableContent>
    </div>
  );
}
