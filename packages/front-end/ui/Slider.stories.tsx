import { useState } from "react";
import { Flex, Slider } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Slider",
  category: "inputs",
  status: "stable",
  summary:
    "Examples of the Radix Themes Slider for picking a value or range on a numeric scale. There is no @/ui wrapper; import Slider from @radix-ui/themes.",
  useWhen: [
    "Adjusting a percentage or number where the approximate position matters more than an exact value.",
  ],
  avoidWhen: [
    {
      reason: "The user needs to type an exact number.",
      use: "TextField",
    },
  ],
  related: ["TextField"],
};
export default function SliderStories() {
  const [sliderVal, setSliderVal] = useState(10);

  return (
    <Flex direction="column" gap="3" maxWidth="300px">
      <div>
        <label>Slider</label>
        <Slider
          value={[sliderVal]}
          min={0}
          max={100}
          step={1}
          onValueChange={(e) => {
            setSliderVal(e[0]);
          }}
        />
        <span>{sliderVal}%</span>
      </div>
      <div>
        <label>Slider in cyan (high contrast) </label>
        <Slider defaultValue={[35]} color="cyan" highContrast />
      </div>
      <div>
        <label>Slider with no Radius</label>
        <Slider defaultValue={[75]} radius="none" />
      </div>
      <div>
        <label>Range Slider with Soft visual style</label>
        <Slider defaultValue={[25, 75]} variant="soft" />
      </div>
      <div>
        <label>Large Slider Disabled</label>
        <Slider defaultValue={[25]} size="3" disabled={true} />
      </div>
    </Flex>
  );
}
