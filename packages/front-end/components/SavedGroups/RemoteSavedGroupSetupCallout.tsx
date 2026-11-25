import { Trans } from "@lingui/react/macro";
import Callout from "@/ui/Callout";
import { DocLink } from "@/components/DocLink";

/** Points to the setup docs: remote groups need storage and SDK support. */
export default function RemoteSavedGroupSetupCallout() {
  return (
    <Callout
      status="info"
      mb="4"
      size="sm"
      dismissible={true}
      id="remote-saved-group-setup"
    >
      <Trans>
        Remote Groups require additional configuration:{" "}
        <DocLink docSection="remoteSavedGroups">View docs</DocLink>
      </Trans>
    </Callout>
  );
}
