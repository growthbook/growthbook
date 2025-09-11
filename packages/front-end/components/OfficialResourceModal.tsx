import { Heading } from "@radix-ui/themes";
import Modal from "./Modal";
import Callout from "./Radix/Callout";

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
}: {
  close: () => void;
  resourceType: ResourceType;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Modal
      open={true}
      trackingEventModalType={`convert-to-official-${resourceType}`}
      trackingEventModalSource="segment-list"
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
          An Official {resourceType} cannot be modified from the GrowthBook UI.
          Future changes can only be made via our REST API.
        </Callout>
      </div>
    </Modal>
  );
}
