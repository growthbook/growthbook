import { PiShieldCheckBold } from "react-icons/pi";
import Callout from "@/ui/Callout";

interface Props {
  activeDraft: { version: number; status: string } | null;
  requiresApproval?: boolean;
}

export default function DraftRevisionCallout({
  activeDraft,
  requiresApproval = true,
}: Props) {
  return (
    <Callout
      status={requiresApproval ? "wizard" : "info"}
      icon={requiresApproval ? <PiShieldCheckBold size={16} /> : undefined}
      mb="4"
    >
      {activeDraft ? (
        <>
          Changes will be added to{" "}
          <strong>Revision {activeDraft.version}</strong> ({activeDraft.status}
          ).
        </>
      ) : (
        <>A new draft revision will be created for these changes.</>
      )}
    </Callout>
  );
}
