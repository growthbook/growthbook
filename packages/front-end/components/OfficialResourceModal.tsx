import { Heading } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Modal from "./Modal";

type ResourceType =
  | "Segment"
  | "Fact Table"
  | "Fact Metric"
  | "Fact Filter"
  | "Metric";

export default function OfficialResourceModal({
  close,
  resourceType,
  onSubmit,
  source,
}: {
  close: () => void;
  resourceType: ResourceType;
  onSubmit: () => Promise<void>;
  source: string;
}) {
  return (
    <Modal
      open={true}
      trackingEventModalType={`convert-to-official-${resourceType}`}
      trackingEventModalSource={source}
      close={close}
      header={null}
      showHeaderCloseButton={false}
      submit={() => onSubmit()}
      closeCta="Cancel"
      cta="Confirm"
    >
      <div className="mr-4 pb-2">
        <Heading as="h4" size="3">
          Convert to Official {resourceType}?
        </Heading>
        <Callout status="info" icon={null} mt="4">
          Once converted to an <strong>Official {resourceType}</strong>, it can
          only be modified in the UI by an Admin or by someone with the{" "}
          <code>ManageOfficialResources</code> policy.
        </Callout>
      </div>
    </Modal>
  );
}
