import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { formatResetsIn } from "./aiAssistantLimit";

// As the upgrade modal's Enterprise path.
const CONTACT_SALES_URL = "https://www.growthbook.io/demo";

export default function AiAssistantLimitCallout({
  id,
  resetsAt,
}: {
  // On the explanation alone (not the link), for the message box's
  // aria-describedby.
  id: string;
  resetsAt: number | null;
}) {
  const canManageBilling = usePermissionsUtil().canManageBilling();
  const resetsIn = resetsAt ? formatResetsIn(resetsAt, Date.now()) : null;
  return (
    <Callout status="warning" size="sm">
      <span id={id}>
        Daily AI Assistant limit reached.
        {resetsIn ? ` Resets ${resetsIn}.` : ""}{" "}
        {canManageBilling
          ? "Enterprise plans have no daily limit."
          : "Contact your admin to upgrade."}
      </span>
      {canManageBilling ? (
        <>
          {" "}
          <Link
            href={CONTACT_SALES_URL}
            external
            weight="medium"
            style={{ whiteSpace: "nowrap" }}
          >
            Contact sales
          </Link>
        </>
      ) : null}
    </Callout>
  );
}
