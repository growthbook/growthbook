import { useCallback, useState } from "react";
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

export const ToggleWithDelayedUpdateBugStory = () => {
  const [enabled, setEnabled] = useState(false);

  const onClick = useCallback(() => {
    setTimeout(() => {
      setEnabled(!enabled);
    }, 1000);
  }, [enabled]);

  return <Toggle id="my-toggle-2" value={enabled} setValue={onClick} />;
};
