import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";

const PaidFeatureBadge = ({ type }: { type: "pro" | "enterprise" }) => {
  const { accountPlan } = useUser();

  if (accountPlan !== "oss" && accountPlan !== "starter") {
    return null;
  }

  return (
    <Tooltip
      body={`This is ${type === "pro" ? "a Pro" : "an Enterprise"} feature`}
      tipPosition="top"
    >
      <span
        className="badge ml-2"
        style={{
          backgroundColor: type === "pro" ? "#978365" : "#050549",
          color: "#FFFFFF",
        }}
      >
        PAID
      </span>
    </Tooltip>
  );
};

export default PaidFeatureBadge;
