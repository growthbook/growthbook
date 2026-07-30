import {
  isSecretDatasourceParamKey,
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

  it("passes public object params through", () => {
    const redacted = redactSecretParams("mssql", {
      server: "sql.example.com",
      password: "hunter2",
      options: { encrypt: true, trustServerCertificate: false },
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

  // `FieldSensitivity` forces any non-string param to "public", so an object
  // param can never be classified secret regardless of what it holds.
  it("omits an object param", () => {
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
