import { Tabs as RadixTabs } from "@radix-ui/themes";
import { ReactNode } from "react";

type TabConfig = {
  slug: string;
  label: string;
  content: ReactNode;
};

type SharedProps = {
  tabs: TabConfig[];
};

type UncontrolledProps = SharedProps & {
  defaultTabSlug?: string;
};

type ControlledProps = SharedProps & {
  activeTab: string;
  onTabChange: (slug: string) => void;
};

export default function Tabs(props: UncontrolledProps | ControlledProps) {
  let radixProps = {};
  if ("activeTab" in props) {
    radixProps = {
      value: props.activeTab,
      onValueChange: props.onTabChange,
    };
  } else {
    radixProps = {
      defaultValue: props.defaultTabSlug,
    };
  }

  const { tabs } = props;

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
