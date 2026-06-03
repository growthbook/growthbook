import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Box, Flex } from "@radix-ui/themes";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ClickToCopy from "@/components/Settings/ClickToCopy";

type Row = {
  label: string;
  sublabel?: string;
  value: string;
};

export default function SDKConnectionCredentialsCard({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const hasProxy = !!connection.proxy?.enabled;
  const apiHost = getApiBaseUrl(connection);
  const clientKey = connection.key;
  const featuresEndpoint = `${apiHost}/api/features/${clientKey}`;
  const encryptionKey = connection.encryptPayload
    ? connection.encryptionKey
    : undefined;

  const rows: Row[] = [
    {
      label: "Full API Endpoint",
      sublabel: hasProxy ? "proxied" : undefined,
      value: featuresEndpoint,
    },
    {
      label: "API Host",
      sublabel: hasProxy ? "proxied" : undefined,
      value: apiHost,
    },
    { label: "Client Key", value: clientKey },
  ];
  if (encryptionKey) {
    rows.push({ label: "Decryption Key", value: encryptionKey });
  }

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: 10,
        background: "var(--color-panel-solid)",
        overflow: "hidden",
      }}
    >
      <Flex
        align="center"
        justify="between"
        gap="2"
        px="4"
        py="3"
        style={{ borderBottom: "1px solid var(--gray-a4)" }}
      >
        <Flex align="center" gap="2">
          <h2 className="mb-0" style={{ fontSize: 15, fontWeight: 600 }}>
            Connection details
          </h2>
        </Flex>
      </Flex>
      <Box>
        {rows.map((row, i) => (
          <Flex
            key={row.label}
            align="center"
            gap="3"
            px="4"
            py="2"
            style={{
              borderTop: i === 0 ? "none" : "1px solid var(--gray-a4)",
              minHeight: 44,
            }}
          >
            <Box style={{ width: 180, flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{row.label}</span>
              {row.sublabel ? (
                <span
                  className="text-muted"
                  style={{ fontSize: 12, marginLeft: 4 }}
                >
                  ({row.sublabel})
                </span>
              ) : null}
            </Box>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <ClickToCopy compact>{row.value}</ClickToCopy>
            </Box>
          </Flex>
        ))}
      </Box>
    </Box>
  );
}
