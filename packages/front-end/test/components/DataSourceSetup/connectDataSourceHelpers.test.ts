import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  hasGeneratedPassword,
  withGeneratedSnowflakeKey,
} from "@/components/DataSourceSetup/connectDataSourceHelpers";

function datasource(
  p: Record<string, unknown>,
): Partial<DataSourceInterfaceWithParams> {
  return p as Partial<DataSourceInterfaceWithParams>;
}

describe("hasGeneratedPassword", () => {
  it("is true while the password field still holds the generated value", () => {
    const initial = datasource({
      type: "postgres",
      params: { password: "gENeRaTeD1" },
    });
    const current = datasource({
      type: "postgres",
      params: { password: "gENeRaTeD1" },
    });
    expect(hasGeneratedPassword(current, initial)).toBe(true);
  });

  it("is false once the password field has been edited", () => {
    const initial = datasource({
      type: "postgres",
      params: { password: "gENeRaTeD1" },
    });
    const current = datasource({
      type: "postgres",
      params: { password: "something-else" },
    });
    expect(hasGeneratedPassword(current, initial)).toBe(false);
  });

  it("is false for warehouse types that don't get a generated password", () => {
    const initial = datasource({
      type: "snowflake",
      params: { password: "gENeRaTeD1" },
    });
    const current = datasource({
      type: "snowflake",
      params: { password: "gENeRaTeD1" },
    });
    expect(hasGeneratedPassword(current, initial)).toBe(false);
  });

  it("is false when nothing was generated", () => {
    const initial = datasource({ type: "postgres", params: {} });
    const current = datasource({
      type: "postgres",
      params: { password: "" },
    });
    expect(hasGeneratedPassword(current, initial)).toBe(false);
  });
});

describe("withGeneratedSnowflakeKey", () => {
  const keyPair = {
    privateKey:
      "-----BEGIN PRIVATE KEY-----\ngenerated\n-----END PRIVATE KEY-----\n",
    publicKey: "generatedPublicKey",
  };

  it("fills the form's empty private key with the generated one", () => {
    const result = withGeneratedSnowflakeKey(
      datasource({ type: "snowflake", params: { privateKey: "" } }),
      keyPair,
    );
    expect(result.params).toMatchObject({ privateKey: keyPair.privateKey });
  });

  it("preserves a private key the user already uploaded", () => {
    const uploaded =
      "-----BEGIN PRIVATE KEY-----\nuploaded\n-----END PRIVATE KEY-----\n";
    const result = withGeneratedSnowflakeKey(
      datasource({ type: "snowflake", params: { privateKey: uploaded } }),
      keyPair,
    );
    expect(result.params).toMatchObject({ privateKey: uploaded });
  });

  it("leaves the form alone once it already holds the generated key", () => {
    const current = datasource({
      type: "snowflake",
      params: { privateKey: keyPair.privateKey },
    });
    expect(withGeneratedSnowflakeKey(current, keyPair)).toBe(current);
  });

  it("leaves the form alone when there is no key yet", () => {
    const current = datasource({ type: "snowflake", params: {} });
    expect(withGeneratedSnowflakeKey(current, null)).toBe(current);
  });

  it("leaves other data source types alone", () => {
    const current = datasource({ type: "postgres", params: {} });
    expect(withGeneratedSnowflakeKey(current, keyPair)).toBe(current);
  });
});
