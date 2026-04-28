import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Frame from "@/ui/Frame";

import AnalysisResultSummaryStories from "@/ui/AnalysisResultSummary.stories";
import AvatarStories from "@/ui/Avatar.stories";
import BadgeStories from "@/ui/Badge.stories";
import BreadcrumbsStories from "@/ui/Breadcrumbs.stories";
import ButtonStories from "@/ui/Button.stories";
import CalloutStories from "@/ui/Callout.stories";
import CheckboxStories from "@/ui/Checkbox.stories";
import DataListStories from "@/ui/DataList.stories";
import DatePickerStories from "@/ui/DatePicker.stories";
import DropdownMenuStories from "@/ui/DropdownMenu.stories";
import ExperimentResultIndicatorStories from "@/ui/ExperimentResultIndicator.stories";
import ExperimentStatusIndicatorStories from "@/ui/ExperimentStatusIndicator.stories";
import TextStories from "@/ui/Text.stories";
import HeadingStories from "@/ui/Heading.stories";
import HelperTextStories from "@/ui/HelperText.stories";
import LinkStories from "@/ui/Link.stories";
import MetadataStories from "@/ui/Metadata.stories";
import PaginationStories from "@/ui/Pagination.stories";
import PopoverStories from "@/ui/Popover.stories";
import PremiumCalloutStories from "@/ui/PremiumCallout.stories";
import RadioCardsStories from "@/ui/RadioCards.stories";
import RadioGroupStories from "@/ui/RadioGroup.stories";
import SelectStories from "@/ui/Select.stories";
import SliderStories from "@/ui/Slider.stories";
import StepperStories from "@/ui/Stepper.stories";
import SwitchStories from "@/ui/Switch.stories";
import TableStories from "@/ui/Table.stories";
import TabsStories from "@/ui/Tabs.stories";
import ProgressBarStories from "@/ui/ProgressBar.stories";
import VariationStatsTableStories from "@/ui/VariationStatsTable.stories";
import DialogStories from "@/ui/Dialog/Dialog.stories";

type StoryEntry = {
  name: string;
  description?: React.ReactNode;
  Stories: () => React.ReactNode;
};

const TOP_NAV_HEIGHT = 56;
const PAGE_TOP_PADDING = 24;
const PAGE_BOTTOM_PADDING = 16;
const SIDEBAR_TOP_OFFSET = TOP_NAV_HEIGHT + PAGE_TOP_PADDING;
const SIDEBAR_MAX_HEIGHT = `calc(100vh - ${
  SIDEBAR_TOP_OFFSET + PAGE_BOTTOM_PADDING
}px)`;

export default function DesignSystemPage() {
  const components = [
    {
      name: "AnalysisResultSummary",
      description: (
        <>
          This displays the results of an analysis in a compact way. It is
          usually rendered inside of a Tooltip or Popover when hovering over
          Experiment results.
        </>
      ),
      Stories: AnalysisResultSummaryStories,
    },
    { name: "Avatar", Stories: AvatarStories },
    { name: "Badge", Stories: BadgeStories },
    { name: "Breadcrumbs", Stories: BreadcrumbsStories },
    { name: "Button", Stories: ButtonStories },
    { name: "Callout", Stories: CalloutStories },
    { name: "Checkbox", Stories: CheckboxStories },
    { name: "DataList", Stories: DataListStories },
    { name: "DatePicker", Stories: DatePickerStories },
    { name: "DropdownMenu", Stories: DropdownMenuStories },
    {
      name: "ExperimentResultIndicator",
      Stories: ExperimentResultIndicatorStories,
    },
    {
      name: "ExperimentStatusIndicator",
      Stories: ExperimentStatusIndicatorStories,
    },
    { name: "VariationStatsTable", Stories: VariationStatsTableStories },
    { name: "Text", Stories: TextStories },
    { name: "Heading", Stories: HeadingStories },
    { name: "HelperText", Stories: HelperTextStories },
    { name: "Link", Stories: LinkStories },
    { name: "Metadata", Stories: MetadataStories },
    { name: "Pagination", Stories: PaginationStories },
    { name: "Popover", Stories: PopoverStories },
    { name: "PremiumCallout", Stories: PremiumCalloutStories },
    { name: "ProgressBar", Stories: ProgressBarStories },
    { name: "RadioCards", Stories: RadioCardsStories },
    { name: "RadioGroup", Stories: RadioGroupStories },
    { name: "Select", Stories: SelectStories },
    { name: "Slider", Stories: SliderStories },
    { name: "Stepper", Stories: StepperStories },
    { name: "Switch", Stories: SwitchStories },
    { name: "Table", Stories: TableStories },
    { name: "Tabs", Stories: TabsStories },
    { name: "Dialog", Stories: DialogStories },
  ] satisfies StoryEntry[];

  const entries = useMemo(
    () =>
      components
        .map((c) => ({
          ...c,
          id: `${slugify(c.name)}-story`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [components],
  );

  return (
    <div className="pt-4 pb-3">
      <Flex gap="6">
        <nav
          aria-label="Components"
          style={{
            position: "sticky",
            top: SIDEBAR_TOP_OFFSET,
            alignSelf: "flex-start",
            minWidth: 220,
            maxHeight: SIDEBAR_MAX_HEIGHT,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Text as="div" weight="semibold" mb="2">
            Components
          </Text>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              overflowY: "auto",
              minHeight: 0,
              paddingRight: 8,
            }}
          >
            {entries.map(({ name, id }) => (
              <li key={id} style={{ marginBottom: 8 }}>
                <Link href={`#${id}`}>{name}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="container-fluid" style={{ flex: 1 }}>
          <h1 className="mb-4">GrowthBook Design System</h1>
          <div className="pagecontents">
            <Flex gap="4" direction="column">
              {entries.map(({ name, description, Stories, id }) => (
                <Frame key={id} id={id} style={{ scrollMarginTop: 90 }}>
                  <Flex direction="column" gap="3">
                    <h3 className="mb-1">{name}</h3>
                    <Text>{description}</Text>
                    <Stories />
                  </Flex>
                </Frame>
              ))}
            </Flex>
          </div>
        </div>
      </Flex>
    </div>
  );
}

DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
