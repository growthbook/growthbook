import {
  decryptSecretFields,
  encryptSecretFields,
  redactSecretFields,
} from "back-end/src/services/confirmations";

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

  it("redacts the field for display", () => {
    expect(redactSecretFields(body, ["connection"])).toEqual({
      name: "Warehouse",
      connection: "[redacted]",
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
