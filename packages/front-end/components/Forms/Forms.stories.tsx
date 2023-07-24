import { useState } from "react";
import Toggle from "@/components/Forms/Toggle";

export default {
  component: Toggle,
  title: "Forms/Toggle",
};

export const ToggleStory = () => {
  const [enabled, setEnabled] = useState(false);
  return (
    <Toggle
      id="my-toggle-1"
      value={enabled}
      setValue={() => setEnabled(!enabled)}
    />
  );
};
