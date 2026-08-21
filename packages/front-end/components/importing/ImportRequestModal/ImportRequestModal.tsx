import React, { FC, useState } from "react";
import track from "@/services/track";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";

const SUPPORT_EMAIL = "support@growthbook.io";

type ImportRequestModalProps = {
  service: string;
  serviceSlug: string;
  close: () => void;
};

export const ImportRequestModal: FC<ImportRequestModalProps> = ({
  service,
  serviceSlug,
  close,
}) => {
  const [details, setDetails] = useState("");

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      trackingEventModalType="import-request"
      trackingEventModalSource={serviceSlug}
    >
      <Modal.Header>
        <Modal.Title>Migrate from {service}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          We don&apos;t have a self-serve {service} importer yet, but our team
          can help you migrate. Reach out to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll
          work with you on a migration plan.
        </p>
        <p>Your interest also helps us decide which importers to build next.</p>
        <Field
          label="Anything we should know? (optional)"
          textarea
          minRows={3}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="e.g. how many flags/experiments you have, your timeline, and what you'd like imported"
        />
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </Modal.Close>
        <Button
          onClick={() => {
            track("Import request submitted", { service: serviceSlug });
            const subject = `Migration from ${service}`;
            const body = `Hi GrowthBook team,\n\nWe're interested in migrating from ${service} to GrowthBook.\n\n${details}`;
            window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
              subject,
            )}&body=${encodeURIComponent(body)}`;
            close();
          }}
        >
          Email {SUPPORT_EMAIL}
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
};
