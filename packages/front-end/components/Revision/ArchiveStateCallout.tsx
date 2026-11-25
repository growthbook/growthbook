import { Trans } from "@lingui/react/macro";
import Callout from "@/ui/Callout";

// Whole sentences per entity type, so a translation can agree with the noun.
type ArchivableEntity = "saved-group" | "constant" | "config";

function UnarchivingText({ entityType }: { entityType: ArchivableEntity }) {
  switch (entityType) {
    case "saved-group":
      return (
        <Trans>
          <strong>This draft will unarchive the Saved Group.</strong> Once
          published, it becomes active again.
        </Trans>
      );
    case "constant":
      return (
        <Trans>
          <strong>This draft will unarchive the Constant.</strong> Once
          published, it becomes active again.
        </Trans>
      );
    case "config":
      return (
        <Trans>
          <strong>This draft will unarchive the Config.</strong> Once published,
          it becomes active again.
        </Trans>
      );
  }
}

function ArchivedText({ entityType }: { entityType: ArchivableEntity }) {
  switch (entityType) {
    case "saved-group":
      return (
        <Trans>
          <strong>This Saved Group is archived.</strong> It stays inactive until
          it&apos;s unarchived.
        </Trans>
      );
    case "constant":
      return (
        <Trans>
          <strong>This Constant is archived.</strong> It stays inactive until
          it&apos;s unarchived.
        </Trans>
      );
    case "config":
      return (
        <Trans>
          <strong>This Config is archived.</strong> It stays inactive until
          it&apos;s unarchived.
        </Trans>
      );
  }
}

function ArchivingText({ entityType }: { entityType: ArchivableEntity }) {
  switch (entityType) {
    case "saved-group":
      return (
        <Trans>
          <strong>This draft will archive the Saved Group.</strong> Once
          published, it becomes inactive.
        </Trans>
      );
    case "constant":
      return (
        <Trans>
          <strong>This draft will archive the Constant.</strong> Once published,
          it becomes inactive.
        </Trans>
      );
    case "config":
      return (
        <Trans>
          <strong>This draft will archive the Config.</strong> Once published,
          it becomes inactive.
        </Trans>
      );
  }
}

export default function ArchiveStateCallout({
  entityType,
  liveArchived,
  viewedArchived,
}: {
  entityType: ArchivableEntity;
  liveArchived: boolean;
  viewedArchived: boolean;
}) {
  if (liveArchived && !viewedArchived) {
    return (
      <Callout status="info" mt="3">
        <UnarchivingText entityType={entityType} />
      </Callout>
    );
  }
  if (liveArchived) {
    return (
      <Callout status="info" mt="3">
        <ArchivedText entityType={entityType} />
      </Callout>
    );
  }
  if (viewedArchived) {
    return (
      <Callout status="warning" mt="3">
        <ArchivingText entityType={entityType} />
      </Callout>
    );
  }
  return null;
}
