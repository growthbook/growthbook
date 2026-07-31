import {
  isSecretDatasourceParamKey,
  mergeDataSourceParams,
  redactSecretParams,
  secretParamKeys,
} from "shared/util";

describe("redactSecretParams", () => {
  it("couples params to the datasource type and drops unknown keys", () => {
    // @ts-expect-error defaultDataset is a BigQuery param, not a MySQL param.
    expect(
      redactSecretParams("mysql", { defaultDataset: "analytics" }),
    ).toEqual({});

    const paramsWithUnknownKey = {
      username: "service-account",
      secret: "hunter2",
      projectId: "123",
      unknown: "must be dropped",
    };
    const redacted = redactSecretParams("mixpanel", paramsWithUnknownKey);
    // @ts-expect-error Unclassified keys are dropped at runtime and from the return type.
    expect(redacted.unknown).toBeUndefined();
  });

  it("blanks secrets and passes public params through", () => {
    const redacted = redactSecretParams("bigquery", {
      projectId: "my-project",
      clientEmail: "sa@my-project.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      serviceAccountJson: '{"private_key":"-----BEGIN PRIVATE KEY-----"}',
      defaultDataset: "analytics",
    });

    expect(redacted).toEqual({
      projectId: "my-project",
      clientEmail: "sa@my-project.iam.gserviceaccount.com",
      privateKey: "",
      serviceAccountJson: "",
      defaultDataset: "analytics",
    });
  });

  it("drops a key the table does not classify", () => {
    const redacted = redactSecretParams("mysql", {
      host: "db.example.com",
      password: "hunter2",
      legacySshTunnelKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
    });

    expect(redacted).toEqual({ host: "db.example.com", password: "" });
  });

  it("recursively passes classified object params through and drops unknown fields", () => {
    const redacted = redactSecretParams("mssql", {
      server: "sql.example.com",
      password: "hunter2",
      anotherNotSpecifiedParam: "this should be dropped",
      options: {
        encrypt: true,
        trustServerCertificate: false,
        accessToken: "must be dropped",
      },
    });

    expect(redacted).toEqual({
      server: "sql.example.com",
      password: "",
      options: { encrypt: true, trustServerCertificate: false },
    });
  });

  it("leaves an absent param absent rather than adding an empty one", () => {
    expect(redactSecretParams("mixpanel", { projectId: "123" })).toEqual({
      projectId: "123",
    });
  });
});

describe("mergeDataSourceParams", () => {
  it("preserves unsubmitted secrets while applying classified nested updates", () => {
    const merged = mergeDataSourceParams(
      "mssql",
      {
        server: "sql.example.com",
        password: "stored password",
        options: { encrypt: true, trustServerCertificate: false },
      },
      {
        password: "",
        options: {
          encrypt: false,
          trustServerCertificate: true,
          accessToken: "must be dropped",
        },
      },
    );

    expect(merged).toEqual({
      server: "sql.example.com",
      password: "stored password",
      options: { encrypt: false, trustServerCertificate: true },
    });
  });
});

describe("secretParamKeys", () => {
  it("lists the credential keys for a type", () => {
    expect(secretParamKeys("presto").sort()).toEqual([
      "caCert",
      "clientCert",
      "clientKey",
      "customAuth",
      "password",
    ]);
  });

  it("only lists top-level credential keys", () => {
    expect(secretParamKeys("mssql")).toEqual(["password"]);
  });
});

describe("isSecretDatasourceParamKey", () => {
  it("covers credential keys across every datasource type", () => {
    [
      "serviceAccountJson",
      "clientKey",
      "customAuth",
      "token",
      "oauthClientSecret",
      "privateKeyPassword",
    ].forEach((key) => expect(isSecretDatasourceParamKey(key)).toBe(true));
  });

  it("does not cover public identifiers", () => {
    ["externalId", "clientEmail", "oauthClientId", "username"].forEach((key) =>
      expect(isSecretDatasourceParamKey(key)).toBe(false),
    );
  });

  it("masks legacy secret aliases from untyped config files", () => {
    expect(isSecretDatasourceParamKey("pass")).toBe(true);
  });
});
