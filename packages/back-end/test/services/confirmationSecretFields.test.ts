import {
  openSecretFields,
  redactSecretFields,
  sealSecretFields,
} from "back-end/src/services/confirmations";

const body = {
  name: "Warehouse",
  connection: { type: "postgres", password: "hunter2", port: 5432 },
};

describe("secret body fields", () => {
  it("stores the field encrypted and replays it unchanged", () => {
    const sealed = sealSecretFields(body, ["connection"]);
    expect(JSON.stringify(sealed)).not.toContain("hunter2");
    expect(sealed).toMatchObject({ name: "Warehouse" });
    expect(openSecretFields(sealed, ["connection"])).toEqual(body);
  });

  it("redacts the field for display", () => {
    expect(redactSecretFields(body, ["connection"])).toEqual({
      name: "Warehouse",
      connection: "[redacted]",
    });
  });

  it("leaves bodies without secret fields alone", () => {
    expect(sealSecretFields(body, undefined)).toBe(body);
    expect(openSecretFields(body, undefined)).toBe(body);
    expect(sealSecretFields({ name: "x" }, ["connection"])).toEqual({
      name: "x",
    });
  });
});
