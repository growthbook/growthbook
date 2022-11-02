import Tooltip from "./Tooltip";

export default {
  title: "Tooltip",
  component: Tooltip,
};

export const Default = () => {
  return (
    <div>
      <Tooltip body="This is a tooltip" />
    </div>
  );
};
