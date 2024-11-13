import { Tabs as RadixTabs } from "@radix-ui/themes";
import { ReactNode } from "react";
import useURLHash from "@/hooks/useURLHash";

type TabConfig = {
  slug: string;
  label: string;
  content: ReactNode;
};

type SharedProps = {
  tabs: TabConfig[];
};

type UncontrolledProps = {
  defaultTabSlug: string;
  persistHash?: boolean;
  activeTab?: never;
  onTabChange?: never;
};

type ControlledProps = {
  defaultTabSlug?: never;
  persistHash?: never;
  activeTab: string;
  onTabChange: (slug: string) => void;
};

export default function Tabs(
  props: SharedProps & (UncontrolledProps | ControlledProps)
) {
  const { tabs } = props;
  const slugs = tabs.map((tab) => tab.slug);

  const [activeTabSlug, setActiveTabSlug] = useURLHash(slugs);

  // If the tabs are controlled, use its values
  // Otherwise, use the URL hash
  let radixProps = {};
  if ("activeTab" in props) {
    radixProps = {
      value: props.activeTab,
      onValueChange: props.onTabChange,
    };
  } else if (props.persistHash) {
    radixProps = {
      value: activeTabSlug,
      onValueChange: setActiveTabSlug,
    };
  } else {
    radixProps = {
      defaultValue: props.defaultTabSlug,
    };
  }

  return (
    <RadixTabs.Root {...radixProps}>
      <RadixTabs.List>
        {tabs.map((tab) => (
          <RadixTabs.Trigger value={tab.slug} key={`${tab.slug}-trigger`}>
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>

      {tabs.map((tab) => (
        <RadixTabs.Content value={tab.slug} key={`${tab.slug}-content`}>
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
