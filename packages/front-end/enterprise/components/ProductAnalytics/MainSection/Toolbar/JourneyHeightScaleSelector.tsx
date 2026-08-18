import type { ComponentType } from "react";
import { Flex } from "@radix-ui/themes";
import { PiAlignTop, PiRows } from "react-icons/pi";
import type {
  ExplorationConfig,
  JourneyDataset,
  JourneyHeightScale,
} from "shared/validators";
import { Select, SelectGroup, SelectItem, SelectLabel } from "@/ui/Select";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const HEIGHT_SCALE_ITEMS: {
  value: JourneyHeightScale;
  label: string;
  icon: ComponentType<{ size?: number }>;
}[] = [
  { value: "relative", label: "Relative", icon: PiRows },
  { value: "absolute", label: "Absolute", icon: PiAlignTop },
];

export default function JourneyHeightScaleSelector() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  if (draftExploreState.dataset?.type !== "journey") return null;

  const activeValue: JourneyHeightScale =
    draftExploreState.dataset.heightScale ?? "relative";

  const setScale = (next: JourneyHeightScale) => {
    setDraftExploreState((prev) => {
      if (prev.dataset?.type !== "journey") return prev;
      return {
        ...prev,
        dataset: { ...prev.dataset, heightScale: next } as JourneyDataset,
      } as ExplorationConfig;
    });
  };

  return (
    <Select
      size="md"
      value={activeValue}
      placeholder="Select height"
      setValue={(v) => setScale(v as JourneyHeightScale)}
    >
      <SelectGroup>
        <SelectLabel>Height</SelectLabel>
        {HEIGHT_SCALE_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <Flex align="center" gap="2">
              <item.icon size={15} /> {item.label}
            </Flex>
          </SelectItem>
        ))}
      </SelectGroup>
    </Select>
  );
}
