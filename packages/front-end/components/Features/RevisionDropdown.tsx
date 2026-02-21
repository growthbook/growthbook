import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { datetime } from "shared/dates";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import EventUser from "@/components/Avatar/EventUser";
import LoadingOverlay from "@/components/LoadingOverlay";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";

export interface Props {
  feature: FeatureInterface;
  revisions: MinimalFeatureRevisionInterface[];
  loading?: boolean;
  version: number;
  setVersion: (version: number) => void;
}

export default function RevisionDropdown({
  feature,
  revisions,
  loading = false,
  version,
  setVersion,
}: Props) {
  const liveVersion = feature.version;

  const allRevisions = [...revisions];

  const versions = new Map(allRevisions.map((r) => [r.version + "", r]));

  const options = allRevisions
    .filter((r) => r.status !== "discarded" || r.version === version)
    .map((r) => ({
      value: r.version + "",
      label: r.version + "",
    }));
  options.sort((a, b) => parseInt(b.value) - parseInt(a.value));

  return (
    <SelectField
      options={options}
      value={version + ""}
      onChange={(version) => setVersion(parseInt(version))}
      sort={false}
      formatOptionLabel={({ value }) => {
        const revision = versions.get(value);

        const date =
          revision?.status === "published"
            ? revision?.datePublished
            : revision?.dateUpdated;

        return (
          <Flex align="center" justify="between" gap="3">
            {loading ? <LoadingOverlay /> : null}
            <Heading size="2" mb="0">
              Revision {value}
            </Heading>
            <Box flexGrow="1" />
            <Box
              flexShrink="1"
              overflow="hidden"
              style={{ textOverflow: "ellipsis" }}
            >
              {date && (
                <Text size="1" color="gray">
                  Created {datetime(date)} by{" "}
                  <EventUser user={revision?.createdBy} display="name" />
                </Text>
              )}
            </Box>
            <Box flexShrink="0">
              <RevisionStatusBadge
                revision={revision}
                liveVersion={liveVersion}
              />
            </Box>
          </Flex>
        );
      }}
    />
  );
}
