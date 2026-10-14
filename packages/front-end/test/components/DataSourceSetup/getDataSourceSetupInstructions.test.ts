import { DataSourceParams } from "shared/types/datasource";
import { isCloud } from "@/services/env";
import { getDataSourceSetupInstructions } from "@/components/DataSourceSetup/getDataSourceSetupInstructions";

vi.mock("@/services/env", () => ({ isCloud: vi.fn(() => true) }));

const CLOUD_EGRESS_IP = "52.70.79.40";
const EU_INGESTOR_IP = "54.74.233.97";

function params(p: Record<string, unknown>): Partial<DataSourceParams> {
  return p as Partial<DataSourceParams>;
}

function codeOf(
  steps: ReturnType<typeof getDataSourceSetupInstructions>,
  title: string,
) {
  const step = steps.find((s) => s.title === title);
  if (!step) throw new Error(`No step titled "${title}"`);
  return step;
}

describe("getDataSourceSetupInstructions", () => {
  beforeEach(() => {
    vi.mocked(isCloud).mockReturnValue(true);
  });

  it("returns at least one step for every Data Source type", () => {
    const types = [
      "bigquery",
      "snowflake",
      "databricks",
      "redshift",
      "athena",
      "presto",
      "clickhouse",
      "postgres",
      "mysql",
      "vertica",
      "mssql",
      "adobe_experience_platform_query_service",
      "mixpanel",
      "google_analytics",
      "growthbook_clickhouse",
    ] as const;
    for (const type of types) {
      expect(
        getDataSourceSetupInstructions(type, "custom").length,
      ).toBeGreaterThan(0);
    }
  });

  describe("form values", () => {
    it("substitutes user, database, schema, and port from the form", () => {
      const steps = getDataSourceSetupInstructions(
        "postgres",
        "custom",
        params({
          user: "analytics_ro",
          database: "warehouse",
          defaultSchema: "events",
          port: "6543",
        }),
      );
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain("CREATE USER analytics_ro");
      expect(create.code).toContain("ON DATABASE warehouse");
      expect(create.code).toContain("ON SCHEMA events");
    });

    it("keeps the case of values typed in the form", () => {
      const steps = getDataSourceSetupInstructions(
        "mysql",
        "custom",
        params({ user: "GrowthBook", database: "Prod_DB" }),
      );
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain("'GrowthBook'@'%'");
      expect(create.code).toContain("ON Prod_DB.*");
    });

    it("uses fallbacks when the form is empty", () => {
      const steps = getDataSourceSetupInstructions("postgres", "custom");
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain("CREATE USER growthbook");
      expect(create.code).toContain("ON SCHEMA public");
    });
  });

  describe("password", () => {
    it.each(["postgres", "redshift", "mysql", "mssql"] as const)(
      "%s: reads the password from the form and says it matches",
      (type) => {
        const steps = getDataSourceSetupInstructions(
          type,
          "custom",
          params({ password: "Abc123xyz" }),
        );
        const create = steps.find((s) => s.code?.includes("Abc123xyz"));
        expect(create).toBeDefined();
        expect(create?.code).not.toContain("use-a-strong-password");
        expect(create?.codeNote).toContain("matches the Password field");
      },
    );

    it("escapes single quotes so the copied SQL stays valid", () => {
      for (const type of ["postgres", "redshift", "mssql"] as const) {
        const step = getDataSourceSetupInstructions(
          type,
          "custom",
          params({ password: "O'Brien123!" }),
        ).find((s) => s.code?.includes("PASSWORD"));
        expect(step?.code).toContain("'O''Brien123!'");
      }
      const snowflake = codeOf(
        getDataSourceSetupInstructions(
          "snowflake",
          "custom",
          params({ authMethod: "password", password: "O'Brien123!" }),
        ),
        "Create a user and grant access",
      );
      expect(snowflake.code).toContain("PASSWORD = 'O''Brien123!'");
    });

    it("doubles backslashes where the warehouse treats them as escapes", () => {
      const password = String.raw`a'b\c`;
      const expected = String.raw`'a''b\\c'`;

      expect(
        codeOf(
          getDataSourceSetupInstructions(
            "mysql",
            "custom",
            params({ password }),
          ),
          "Create a read-only user",
        ).code,
      ).toContain(`IDENTIFIED BY ${expected}`);

      expect(
        codeOf(
          getDataSourceSetupInstructions(
            "redshift",
            "custom",
            params({ password }),
          ),
          "Create a read-only user",
        ).code,
      ).toContain(`WITH PASSWORD ${expected}`);

      expect(
        codeOf(
          getDataSourceSetupInstructions(
            "snowflake",
            "custom",
            params({ authMethod: "password", password }),
          ),
          "Create a user and grant access",
        ).code,
      ).toContain(`PASSWORD = ${expected}`);
    });

    it("leaves backslashes alone where they are literal", () => {
      const password = String.raw`a'b\c`;
      const expected = String.raw`'a''b\c'`;

      expect(
        codeOf(
          getDataSourceSetupInstructions(
            "postgres",
            "custom",
            params({ password }),
          ),
          "Create a read-only user",
        ).code,
      ).toContain(`WITH PASSWORD ${expected}`);

      expect(
        codeOf(
          getDataSourceSetupInstructions(
            "mssql",
            "custom",
            params({ password }),
          ),
          "Create a read-only login",
        ).code,
      ).toContain(`WITH PASSWORD = ${expected}`);
    });

    it("preserves the exact value, including surrounding spaces", () => {
      const create = codeOf(
        getDataSourceSetupInstructions(
          "postgres",
          "custom",
          params({ password: "  padded  " }),
        ),
        "Create a read-only user",
      );
      expect(create.code).toContain("WITH PASSWORD '  padded  '");
    });

    it("falls back to a placeholder with a note when the field is blank", () => {
      const steps = getDataSourceSetupInstructions("postgres", "custom");
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain("'use-a-strong-password'");
      expect(create.codeNote).toContain("Replace `use-a-strong-password`");
    });

    it("snowflake only notes the password for password auth", () => {
      const withPassword = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        params({ authMethod: "password", password: "Sn0wflake" }),
      );
      const create = codeOf(withPassword, "Create a user and grant access");
      expect(create.code).toContain("PASSWORD = 'Sn0wflake'");
      expect(create.codeNote).toContain("matches the Password field");

      const keyPair = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        params({ authMethod: "key-pair" }),
      );
      const keyStep = codeOf(keyPair, "Create a user and grant access");
      expect(keyStep.code).toContain("RSA_PUBLIC_KEY");
      expect(keyStep.codeNote).toBeUndefined();
    });
  });

  describe("snowflake auth default", () => {
    it("defaults new connections to key-pair", () => {
      const steps = getDataSourceSetupInstructions("snowflake", "custom");
      const create = codeOf(steps, "Create a user and grant access");
      expect(create.code).toContain("RSA_PUBLIC_KEY");
    });

    it("defaults saved connections without authMethod to password", () => {
      const steps = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        undefined,
        { existing: true },
      );
      const create = codeOf(steps, "Create a user and grant access");
      expect(create.code).toContain("PASSWORD =");
    });
  });

  describe("network access", () => {
    it("cloud: shows the egress IP and no Docker guidance", () => {
      for (const type of ["postgres", "mysql", "mssql"] as const) {
        const network = codeOf(
          getDataSourceSetupInstructions(type, "custom"),
          "Allow network access",
        );
        expect(network.code).toContain(CLOUD_EGRESS_IP);
        expect(network.description).not.toContain("host.docker.internal");
      }
    });

    it("self-hosted: shows Docker guidance and no egress IP", () => {
      vi.mocked(isCloud).mockReturnValue(false);
      for (const type of ["postgres", "mysql", "mssql"] as const) {
        const network = codeOf(
          getDataSourceSetupInstructions(type, "custom"),
          "Allow network access",
        );
        expect(network.code).toBeUndefined();
        expect(network.description).toContain("host.docker.internal");
      }
    });
  });

  describe("event forwarder", () => {
    it("snowflake: adds write grants and both ingest IPs with the EU note", () => {
      const steps = getDataSourceSetupInstructions(
        "snowflake",
        "event_forwarder",
      );
      const create = codeOf(steps, "Create a user and grant access");
      expect(create.code).toContain("GRANT CREATE SCHEMA ON DATABASE");
      expect(create.code).toContain("GRANT INSERT ON FUTURE TABLES");

      const network = codeOf(steps, "Allow network access");
      expect(network.code).toContain(
        `'${CLOUD_EGRESS_IP}', '${EU_INGESTOR_IP}'`,
      );
      expect(network.codeNote).toContain("eu-west-1");
    });

    it("snowflake custom: lists only the egress IP", () => {
      const network = codeOf(
        getDataSourceSetupInstructions("snowflake", "custom"),
        "Allow network access",
      );
      expect(network.code).toContain(CLOUD_EGRESS_IP);
      expect(network.code).not.toContain(EU_INGESTOR_IP);
      expect(network.codeNote).toBeUndefined();
    });

    it("databricks: adds the Unity Catalog write grant and both IPs", () => {
      const steps = getDataSourceSetupInstructions(
        "databricks",
        "event_forwarder",
      );
      expect(codeOf(steps, "Grant access").code).toContain("CREATE TABLE");
      const network = codeOf(steps, "Allow network access");
      expect(network.code).toContain(EU_INGESTOR_IP);
      expect(network.codeNote).toContain("eu-west-1");
    });

    it("bigquery: inserts the write step before the final credentials step", () => {
      const steps = getDataSourceSetupInstructions(
        "bigquery",
        "event_forwarder",
      );
      const titles = steps.map((s) => s.title);
      expect(titles.indexOf("Grant write access for Event Forwarder")).toBe(
        titles.length - 2,
      );
      expect(titles[titles.length - 1]).toBe("Enter credentials and test");
    });
  });

  it("redshift grants USAGE on the schema before SELECT", () => {
    const create = codeOf(
      getDataSourceSetupInstructions(
        "redshift",
        "custom",
        params({ defaultSchema: "analytics" }),
      ),
      "Create a read-only user",
    );
    const usage = create.code?.indexOf("GRANT USAGE ON SCHEMA analytics") ?? -1;
    const select =
      create.code?.indexOf("GRANT SELECT ON ALL TABLES IN SCHEMA analytics") ??
      -1;
    expect(usage).toBeGreaterThan(-1);
    expect(select).toBeGreaterThan(usage);
  });
});
