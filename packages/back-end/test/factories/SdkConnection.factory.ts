import { Factory } from "fishery";
import { SDKConnectionInterface } from "shared/types/sdk-connection";

export const sdkConnectionFactory = Factory.define<SDKConnectionInterface>(
  ({ sequence, params }) => ({
    id: `sdk_connection_id_${sequence}`,
    name: `sdk-connection-${sequence}`,
    organization: params.organization,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    languages: ["javascript"],
    environment: params.environment,
    projects: [],
    encryptPayload: false,
    encryptionKey: "",
    key: `sdk_connection_key_${sequence}`,
    connected: false,
    proxy: {
      enabled: false,
      host: "",
      signingKey: "",
      connected: false,
      version: "",
      error: "",
      lastError: null,
    },
  }),
);
