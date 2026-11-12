import { useState } from "react";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge, {
  RevisionLike,
} from "@/components/Reviews/RevisionStatusBadge";

// Shared "edit revision description" modal. Entity-agnostic: the caller owns
// the persistence via `onSubmit`, so the same modal serves features
// (PUT /feature/:id/:v/comment) and saved groups (PATCH /revision/:id/description).
export default function EditRevisionDescriptionModal({
  initialValue,
  onSubmit,
  close,
  trackingEventModalType = "edit-revision-description",
  header = "Edit Revision Description",
  placeholder = "Describe this revision...",
  revision,
  liveVersion,
}: {
  initialValue: string;
  onSubmit: (value: string) => void | Promise<void>;
  close: () => void;
  trackingEventModalType?: string;
  header?: string;
  placeholder?: string;
  // Named under the header, so it's clear which one is being described.
  revision?: RevisionLike & { title?: string | null };
  // For the badge, which calls the live revision "Live".
  liveVersion?: number;
}) {
  const [value, setValue] = useState(initialValue);
  // An image still uploading would be dropped from the saved description.
  const [uploading, setUploading] = useState(false);

  return (
    <ModalStandard
      trackingEventModalType={trackingEventModalType}
      open={true}
      close={close}
      header={header}
      subheader={
        revision ? (
          <>
            For{" "}
            <Text as="span" size="inherit" weight="semibold" color="text-high">
              <RevisionLabel
                version={revision.version}
                title={revision.title}
                // Untitled, it's already "Revision N".
                numbered={!!revision.title}
                minWidth={0}
                numberSize="inherit"
              />
            </Text>
            {liveVersion !== undefined ? (
              <>
                {" "}
                <RevisionStatusBadge
                  revision={revision}
                  liveVersion={liveVersion}
                />
              </>
            ) : null}
          </>
        ) : undefined
      }
      size="lg"
      cta="Save"
      ctaEnabled={!uploading}
      submit={async () => {
        await onSubmit(value.trim());
      }}
    >
      {/* Laid out as a new draft's details are. */}
      <SetupFieldRow label="Description">
        <AIRichTextField
          value={value}
          onChange={setValue}
          placeholder={placeholder}
          height="xs"
          collapsibleToolbar
          autoFocus
          onUploadingChange={setUploading}
        />
      </SetupFieldRow>
    </ModalStandard>
  );
}
