import React from "react";
import { Revision } from "shared/enterprise";
import { Box, Flex } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";

interface RevisionVersionSelectorProps {
  openRevisions: Revision[];
  allRevisions?: Revision[];
  selectedRevisionId: string | null;
  onSelectRevision: (revision: Revision | null) => void;
  onCreateNewRevision?: () => void;
}

export default function RevisionVersionSelector({
  openRevisions,
  allRevisions = openRevisions,
  selectedRevisionId,
  onSelectRevision,
  onCreateNewRevision,
}: RevisionVersionSelectorProps) {
  const { getUserDisplay } = useUser();

  const sortedAllRevisions = [...allRevisions].sort(
    (a, b) =>
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
  );

  const revisionNumberById = new Map<string, number>(
    sortedAllRevisions.map((revision, i) => [revision.id, i + 1]),
  );

  // Separate revisions by status
  const openRevs = allRevisions.filter(
    (r) => r.status !== "merged" && r.status !== "closed",
  );
  const closedMergedRevs = allRevisions.filter(
    (r) => r.status === "merged" || r.status === "closed",
  );

  // Find the most recently merged revision to use for "Live" label
  const liveRevision = [...allRevisions]
    .filter((r) => r.status === "merged")
    .sort(
      (a, b) =>
        new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
    )[0];

  const liveLabel = liveRevision
    ? `Revision ${revisionNumberById.get(liveRevision.id) ?? 1} (Live)`
    : "Live";

  const options = [
    { label: liveLabel, value: "live" },
    ...[...openRevs]
      .sort(
        (a, b) =>
          (revisionNumberById.get(b.id) ?? 0) -
          (revisionNumberById.get(a.id) ?? 0),
      )
      .map((revision) => ({
        label:
          revision.title ||
          `Revision ${revisionNumberById.get(revision.id) ?? 1}`,
        value: revision.id,
      })),
    ...(onCreateNewRevision
      ? [{ label: "Add new revision", value: "__new__" }]
      : []),
    ...(closedMergedRevs.length > 0
      ? [
          { label: "───────────", value: "__divider__", isDisabled: true },
          ...[...closedMergedRevs]
            .sort(
              (a, b) =>
                (revisionNumberById.get(b.id) ?? 0) -
                (revisionNumberById.get(a.id) ?? 0),
            )
            .map((revision) => ({
              label:
                revision.title ||
                `Revision ${revisionNumberById.get(revision.id) ?? 1}`,
              value: revision.id,
            })),
        ]
      : []),
  ];

  const optionRevisionMap = new Map<string, Revision | null>([
    ["live", null],
    ...allRevisions.map((revision) => [revision.id, revision] as const),
  ]);

  const selectedValue =
    selectedRevisionId && optionRevisionMap.has(selectedRevisionId)
      ? selectedRevisionId
      : "live";

  return (
    <div
      style={{
        position: "relative",
        width: 430,
        maxWidth: "min(430px, calc(100vw - 150px))",
      }}
    >
      <SelectField
        value={selectedValue}
        options={options}
        sort={false}
        isSearchable={false}
        label=""
        style={{ width: "100%", maxWidth: "100%" }}
        onChange={(value) => {
          if (value === "__divider__") {
            return; // Ignore divider clicks
          }
          if (value === "__new__" && onCreateNewRevision) {
            onCreateNewRevision();
            return;
          }
          const selectedRevision = optionRevisionMap.get(value) ?? null;
          onSelectRevision(selectedRevision);
        }}
        formatOptionLabel={({ value, label }) => {
          if (value === "__divider__") {
            return (
              <div style={{ textAlign: "center", color: "var(--gray-8)" }}>
                {label}
              </div>
            );
          }
          if (value === "__new__") {
            return (
              <Flex align="center" justify="between" gap="3">
                <span style={{ color: "var(--violet-9)", fontWeight: 600 }}>
                  {label}
                </span>
              </Flex>
            );
          }
          const revision = optionRevisionMap.get(value) ?? null;
          const isLive = value === "live";

          return (
            <Flex align="center" justify="between" gap="3">
              <Text as="span" weight="semibold">
                {label}
              </Text>
              <Box flexGrow="1" />
              <Box
                flexShrink="1"
                overflow="hidden"
                style={{ textOverflow: "ellipsis" }}
              >
                {revision && !isLive && (
                  <Text as="span" size="small" color="text-low">
                    by {getUserDisplay(revision.authorId)}
                  </Text>
                )}
                {isLive && liveRevision && (
                  <Text as="span" size="small" color="text-low">
                    by {getUserDisplay(liveRevision.authorId)}
                  </Text>
                )}
              </Box>
              <Box flexShrink="0">
                {revision ? (
                  <Badge
                    label={
                      revision.status === "merged"
                        ? "Merged"
                        : revision.status === "closed"
                          ? "Closed"
                          : revision.status === "approved"
                            ? "Approved"
                            : revision.status === "changes-requested"
                              ? "Changes Requested"
                              : "Draft"
                    }
                    color={
                      revision.status === "merged"
                        ? "green"
                        : revision.status === "closed"
                          ? "gray"
                          : revision.status === "approved"
                            ? "blue"
                            : revision.status === "changes-requested"
                              ? "orange"
                              : "indigo"
                    }
                    radius="full"
                  />
                ) : (
                  <Badge label="Live" color="teal" radius="full" />
                )}
              </Box>
            </Flex>
          );
        }}
      />
    </div>
  );
}
