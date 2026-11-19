import { postDataSourceValidator } from "shared/validators";
import {
  decryptSecretFields,
  encryptSecretFields,
  heldBodyForDisplay,
  holdAtRoute,
  redactSecretFields,
} from "back-end/src/services/confirmations";
import { ConfirmationRequiredError } from "back-end/src/util/errors";
import type { ReqContext } from "back-end/types/request";

const body = {
  name: "Warehouse",
  connection: { type: "postgres", password: "hunter2", port: 5432 },
};

describe("secret body fields", () => {
  it("stores the field encrypted and replays it unchanged", () => {
    const encrypted = encryptSecretFields(body, ["connection"]);
    expect(JSON.stringify(encrypted)).not.toContain("hunter2");
    expect(encrypted).toMatchObject({ name: "Warehouse" });
    expect(decryptSecretFields(encrypted, ["connection"])).toEqual(body);
  });

  it("shows a connection's public params and hides its secrets", () => {
    expect(redactSecretFields(body, ["connection"])).toEqual({
      name: "Warehouse",
      connection: { type: "postgres", password: "[redacted]", port: 5432 },
    });
  });

  it("hides a password inside a public URL", () => {
    const url = "https://admin:hunter2@ch.example.com:8443/";
    expect(
      redactSecretFields({ c: { type: "clickhouse", url } }, ["c"]),
    ).toEqual({
      c: { type: "clickhouse", url: "https://admin:***@ch.example.com:8443/" },
    });
  });

  it("shows a stored held body decrypted, without its secrets", () => {
    const stored = {
      body: encryptSecretFields(body, ["connection"]),
      secretBodyFields: ["connection"],
    };
    expect(heldBodyForDisplay(stored)).toEqual(
      redactSecretFields(body, ["connection"]),
    );
    expect(JSON.stringify(heldBodyForDisplay(stored))).not.toContain("hunter2");
  });

  it("hides everything but the type of an unknown connection type", () => {
    expect(
      redactSecretFields({ c: { type: "nope", host: "h" } }, ["c"]),
    ).toEqual({ c: { type: "nope", host: "[redacted]" } });
    expect(redactSecretFields({ c: "secret" }, ["c"])).toEqual({
      c: "[redacted]",
    });
  });

  it("leaves bodies without secret fields alone", () => {
    expect(encryptSecretFields(body, undefined)).toBe(body);
    expect(decryptSecretFields(body, undefined)).toBe(body);
    expect(encryptSecretFields({ name: "x" }, ["connection"])).toEqual({
      name: "x",
    });
  });
});

describe("holding a create data source request", () => {
  it("stores its connection encrypted", async () => {
    const create = jest.fn(async (doc) => ({
      ...doc,
      id: "cnf_1",
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const req = {
      method: "POST",
      originalUrl: "/api/v1/data-sources",
      query: {},
      body,
    };
    const { method, path, tags, confirmation, secretBodyFields } =
      postDataSourceValidator;
    const held = holdAtRoute(
      {
        isApiRequest: true,
        apiKey: "key_1",
        org: { settings: {} },
        apiKeyData: { confirmRules: [{ actions: ["settings.dataSources"] }] },
        models: {
          confirmations: { findPending: async () => null, create },
          confirmationAttempts: {},
        },
        req,
      } as unknown as ReqContext,
      confirmation,
      tags,
      method,
      path,
      req,
      undefined,
      secretBodyFields,
    );
    await expect(held).rejects.toThrow(ConfirmationRequiredError);

    const stored = create.mock.calls[0][0];
    expect(JSON.stringify(stored)).not.toContain("hunter2");
    expect(stored.secretBodyFields).toEqual(["connection"]);
    expect(decryptSecretFields(stored.body, stored.secretBodyFields)).toEqual(
      body,
    );
  });
});
