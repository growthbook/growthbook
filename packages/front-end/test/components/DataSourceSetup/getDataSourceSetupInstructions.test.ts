import { DataSourceParams } from "shared/types/datasource";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { getDataSourceSetupInstructions } from "@/components/DataSourceSetup/getDataSourceSetupInstructions";

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

  it("ends every connectable type with the test step and never asks to fill the form", () => {
    const connectable = [
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
    ] as const;
    for (const type of connectable) {
      const steps = getDataSourceSetupInstructions(type, "custom");
      expect(steps[steps.length - 1].title).toBe("Test the connection");
      for (const step of steps) {
        expect(step.description).not.toMatch(/then test/i);
      }
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
      expect(create.code).toContain('CREATE USER "analytics_ro"');
      expect(create.code).toContain('ON DATABASE "warehouse"');
      expect(create.code).toContain('ON SCHEMA "events"');
    });

    it("quotes Postgres identifiers so mixed case matches the form", () => {
      const steps = getDataSourceSetupInstructions(
        "postgres",
        "custom",
        params({
          user: "GrowthBook",
          database: "Prod_DB",
          defaultSchema: 'odd"schema',
        }),
      );
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain('CREATE USER "GrowthBook"');
      expect(create.code).toContain('ON DATABASE "Prod_DB" TO "GrowthBook"');
      expect(create.code).toContain('ON SCHEMA "odd""schema"');
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
      expect(create.code).toContain('CREATE USER "growthbook"');
      expect(create.code).toContain('ON SCHEMA "public"');
    });
  });

  describe("password", () => {
    const MASK = "'••••••••'";

    it.each(["postgres", "redshift", "mysql", "mssql"] as const)(
      "%s: masks the password on screen and puts the real one in the copy text",
      (type) => {
        const steps = getDataSourceSetupInstructions(
          type,
          "custom",
          params({ password: "Abc123xyz" }),
        );
        const create = steps.find((s) => s.codeToCopy !== undefined);
        expect(create).toBeDefined();
        expect(create?.code).toContain(MASK);
        expect(create?.code).not.toContain("Abc123xyz");
        expect(create?.codeToCopy).toContain("'Abc123xyz'");
        expect(create?.codeToCopy).not.toContain(MASK);
        expect(create?.codeNote).toContain("hidden");
      },
    );

    it("copy text matches the displayed SQL apart from the password", () => {
      const create = codeOf(
        getDataSourceSetupInstructions(
          "postgres",
          "custom",
          params({ user: "ro", password: "Abc123xyz" }),
        ),
        "Create a read-only user",
      );
      expect(create.codeToCopy).toBe(create.code?.replace(MASK, "'Abc123xyz'"));
    });

    it("escapes single quotes so the copied SQL stays valid", () => {
      const p = params({ password: "O'Brien123!" });
      for (const type of ["postgres", "redshift", "mssql"] as const) {
        const step = getDataSourceSetupInstructions(type, "custom", p).find(
          (s) => s.code?.includes("PASSWORD"),
        );
        expect(step?.codeToCopy).toContain("'O''Brien123!'");
      }
      const snowflake = codeOf(
        getDataSourceSetupInstructions(
          "snowflake",
          "custom",
          params({ authMethod: "password", password: "O'Brien123!" }),
        ),
        "Create a user and grant access",
      );
      expect(snowflake.codeToCopy).toContain("PASSWORD = 'O''Brien123!'");
    });

    it("doubles backslashes where the warehouse treats them as escapes", () => {
      const password = String.raw`a'b\c`;
      const expected = String.raw`'a''b\\c'`;
      const p = params({ password });

      expect(
        codeOf(
          getDataSourceSetupInstructions("mysql", "custom", p),
          "Create a read-only user",
        ).codeToCopy,
      ).toContain(`IDENTIFIED BY ${expected}`);

      expect(
        codeOf(
          getDataSourceSetupInstructions("redshift", "custom", p),
          "Create a read-only user",
        ).codeToCopy,
      ).toContain(`WITH PASSWORD ${expected}`);

      expect(
        codeOf(
          getDataSourceSetupInstructions(
            "snowflake",
            "custom",
            params({ authMethod: "password", password }),
          ),
          "Create a user and grant access",
        ).codeToCopy,
      ).toContain(`PASSWORD = ${expected}`);
    });

    it("leaves backslashes alone where they are literal", () => {
      const password = String.raw`a'b\c`;
      const expected = String.raw`'a''b\c'`;
      const p = params({ password });

      expect(
        codeOf(
          getDataSourceSetupInstructions("postgres", "custom", p),
          "Create a read-only user",
        ).codeToCopy,
      ).toContain(`WITH PASSWORD ${expected}`);

      expect(
        codeOf(
          getDataSourceSetupInstructions("mssql", "custom", p),
          "Create a read-only login",
        ).codeToCopy,
      ).toContain(`WITH PASSWORD = ${expected}`);
    });

    it("uses a placeholder with no separate copy text when the field is blank", () => {
      const steps = getDataSourceSetupInstructions("postgres", "custom");
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain("WITH PASSWORD '<password>'");
      expect(create.codeToCopy).toBeUndefined();
      expect(create.codeNote).toContain("Enter a password");
    });

    it("snowflake only notes the password for password auth", () => {
      const withPassword = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        params({ authMethod: "password", password: "Sn0wflake" }),
      );
      const create = codeOf(withPassword, "Create a user and grant access");
      expect(create.code).toContain(`PASSWORD = ${MASK}`);
      expect(create.codeToCopy).toContain("PASSWORD = 'Sn0wflake'");
      expect(create.codeNote).toContain("hidden");

      const keyPair = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        params({ authMethod: "key-pair" }),
      );
      const keyStep = codeOf(keyPair, "Create a user and grant access");
      expect(keyStep.code).toContain(
        "RSA_PUBLIC_KEY = '<contents of rsa_key.pub>'",
      );
      expect(keyStep.code).toContain("TYPE = SERVICE");
      expect(keyStep.codeNote).toContain("Add or generate a private key");
    });
  });

  describe("snowflake generated key pair", () => {
    const keyPair = {
      privateKey:
        "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n",
      publicKey: "MIIBIjANBgkq",
    };

    it("puts the public key in the SQL while the private key is in the form", () => {
      const steps = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        params({ authMethod: "key-pair", privateKey: keyPair.privateKey }),
        { snowflakeKeyPair: keyPair },
      );
      const create = codeOf(steps, "Create a user and grant access");
      expect(create.code).toContain("RSA_PUBLIC_KEY = '••••••••'");
      expect(create.code).not.toContain(keyPair.publicKey);
      expect(create.codeToCopy).toContain(
        `RSA_PUBLIC_KEY = '${keyPair.publicKey}'`,
      );
      expect(create.code).not.toContain("BEGIN PRIVATE KEY");
      expect(create.codeNote).toContain("hidden");
    });

    it("falls back to the placeholder once a different key is uploaded", () => {
      const steps = getDataSourceSetupInstructions(
        "snowflake",
        "custom",
        params({ authMethod: "key-pair", privateKey: "something else" }),
        { snowflakeKeyPair: keyPair },
      );
      const create = codeOf(steps, "Create a user and grant access");
      expect(create.code).not.toContain(keyPair.publicKey);
      expect(create.code).toContain("'<contents of rsa_key.pub>'");
      // A key is present, so no prompt to add one.
      expect(create.codeNote).toBeUndefined();
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

  describe("editing an existing user", () => {
    // The saved connection as the API returns it: secrets redacted. Typed
    // as Postgres so spreads keep their field names; Redshift, MySQL, and
    // MSSQL use the same ones.
    const savedPg: Partial<PostgresConnectionParams> = {
      user: "ro",
      database: "gb",
      defaultSchema: "public",
      password: "",
    };
    const editing = (saved: Partial<DataSourceParams>) => ({
      existing: true,
      saved,
    });
    const updateOf = (
      type: Parameters<typeof getDataSourceSetupInstructions>[0],
      setup: "custom" | "event_forwarder",
      current: Partial<DataSourceParams>,
      saved: Partial<DataSourceParams>,
    ) =>
      codeOf(
        getDataSourceSetupInstructions(type, setup, current, editing(saved)),
        "Update the user",
      );

    it.each([
      ["postgres", 'ALTER USER "ro" WITH PASSWORD'],
      ["redshift", "ALTER USER ro PASSWORD"],
      ["mysql", "ALTER USER 'ro'@'%' IDENTIFIED BY"],
      ["mssql", "ALTER LOGIN ro WITH PASSWORD ="],
    ] as const)(
      "%s: alters the password instead of creating a user",
      (type, alter) => {
        const steps = getDataSourceSetupInstructions(
          type,
          "custom",
          { ...savedPg, password: "N3wPass" },
          editing(savedPg),
        );
        const update = codeOf(steps, "Update the user");
        expect(update.code).toContain(alter);
        expect(update.code).not.toContain("CREATE");
        expect(update.code).not.toContain("GRANT");
        expect(update.codeToCopy).toContain("'N3wPass'");
        expect(steps.some((s) => s.title.startsWith("Create"))).toBe(false);
      },
    );

    it("shows the ALTER with a placeholder when the password field is blank", () => {
      const update = updateOf("postgres", "custom", savedPg, savedPg);
      expect(update.code).toBe(`ALTER USER "ro" WITH PASSWORD '<password>';`);
      expect(update.codeToCopy).toBeUndefined();
      expect(update.description).toContain("Only needed to rotate");
      expect(update.codeNote).toContain("Enter a password");
    });

    it("treats a blank saved schema and a typed default as unchanged", () => {
      const update = updateOf(
        "postgres",
        "custom",
        { ...savedPg, defaultSchema: "public" },
        { ...savedPg, defaultSchema: "" },
      );
      expect(update.code).not.toContain("GRANT");
    });

    describe("grants for changed fields", () => {
      it("postgres: database change grants CONNECT and the schema grants", () => {
        const update = updateOf(
          "postgres",
          "custom",
          { ...savedPg, database: "analytics" },
          savedPg,
        );
        expect(update.description).toContain("The database changed.");
        expect(update.code).toBe(
          `GRANT CONNECT ON DATABASE "analytics" TO "ro";
GRANT USAGE ON SCHEMA "public" TO "ro";
GRANT SELECT ON ALL TABLES IN SCHEMA "public" TO "ro";
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT ON TABLES TO "ro";`,
        );
        expect(update.code).not.toContain("ALTER USER");
        expect(update.codeNote).toContain("rotate them as well");
      });

      it("postgres: schema change grants only on the schema", () => {
        const update = updateOf(
          "postgres",
          "custom",
          { ...savedPg, defaultSchema: "events" },
          savedPg,
        );
        expect(update.description).toContain("The schema changed.");
        expect(update.code).toContain('GRANT USAGE ON SCHEMA "events"');
        expect(update.code).not.toContain("GRANT CONNECT");
      });

      it("prepends the password ALTER when the field is filled too", () => {
        const update = updateOf(
          "postgres",
          "custom",
          { ...savedPg, database: "analytics", password: "N3wPass" },
          savedPg,
        );
        expect(update.description).toContain("Rotate the credentials");
        expect(update.code?.startsWith(`ALTER USER "ro" WITH PASSWORD`)).toBe(
          true,
        );
        expect(update.code).toContain("GRANT CONNECT");
        expect(update.codeToCopy).toContain("'N3wPass'");
        expect(update.codeToCopy).toContain("GRANT CONNECT");
      });

      it("redshift: database or schema change repeats the schema grants", () => {
        const byDatabase = updateOf(
          "redshift",
          "custom",
          { ...savedPg, database: "dev" },
          savedPg,
        );
        expect(byDatabase.code).toContain("GRANT USAGE ON SCHEMA public");
        const bySchema = updateOf(
          "redshift",
          "custom",
          { ...savedPg, defaultSchema: "events" },
          savedPg,
        );
        expect(bySchema.code).toContain("GRANT USAGE ON SCHEMA events");
      });

      it("mysql: database change grants SELECT on the new database", () => {
        const update = updateOf(
          "mysql",
          "custom",
          { ...savedPg, database: "analytics" },
          savedPg,
        );
        expect(update.code).toBe(
          `GRANT SELECT ON analytics.* TO 'ro'@'%';
FLUSH PRIVILEGES;`,
        );
      });

      it("mssql: database change creates the database user before granting", () => {
        const update = updateOf(
          "mssql",
          "custom",
          { ...savedPg, database: "analytics" },
          savedPg,
        );
        expect(update.code).toBe(
          `CREATE USER ro FOR LOGIN ro;
GRANT SELECT ON SCHEMA::public TO ro;`,
        );
        const bySchema = updateOf(
          "mssql",
          "custom",
          { ...savedPg, defaultSchema: "events" },
          savedPg,
        );
        expect(bySchema.code).toBe("GRANT SELECT ON SCHEMA::events TO ro;");
      });

      it("lists every changed field in the description", () => {
        const update = updateOf(
          "snowflake",
          "custom",
          params({
            username: "GB",
            authMethod: "key-pair",
            warehouse: "WH2",
            database: "DB2",
          }),
          params({
            username: "GB",
            authMethod: "key-pair",
            warehouse: "WH1",
            database: "DB1",
          }),
        );
        expect(update.description).toContain(
          "The warehouse and database changed.",
        );
        expect(update.description).toContain("new ones");
      });
    });

    describe("snowflake", () => {
      const savedSf: Partial<SnowflakeConnectionParams> = {
        username: "GB",
        role: "GROWTHBOOK_ROLE",
        warehouse: "WH",
        database: "DB",
        schema: "EVENTS",
        authMethod: "password",
        password: "",
      };

      it("alters the password, key, or identity binding", () => {
        const password = updateOf(
          "snowflake",
          "custom",
          { ...savedSf, password: "pw" },
          savedSf,
        );
        expect(password.code).toBe("ALTER USER GB SET PASSWORD = '••••••••';");
        expect(password.codeToCopy).toBe("ALTER USER GB SET PASSWORD = 'pw';");

        const keyPair = updateOf(
          "snowflake",
          "custom",
          { ...savedSf, authMethod: "key-pair" },
          savedSf,
        );
        expect(keyPair.code).toBe(
          "ALTER USER GB SET RSA_PUBLIC_KEY = '<contents of rsa_key.pub>';",
        );
        expect(keyPair.codeNote).toContain("Add or generate a private key");

        const wif = updateOf(
          "snowflake",
          "custom",
          {
            ...savedSf,
            authMethod: "workload-identity",
            workloadIdentityProvider: "GCP",
          },
          savedSf,
        );
        expect(wif.code).toContain("ALTER USER GB SET WORKLOAD_IDENTITY = (");
        expect(wif.code).toContain("TYPE = GCP");
      });

      it("warehouse change grants usage on the new warehouse only", () => {
        const update = updateOf(
          "snowflake",
          "custom",
          { ...savedSf, warehouse: "WH2" },
          savedSf,
        );
        expect(update.code).toBe(
          `GRANT USAGE ON WAREHOUSE WH2
  TO ROLE GROWTHBOOK_ROLE;`,
        );
      });

      it("database change grants on the new database, plus EF grants when forwarding", () => {
        const custom = updateOf(
          "snowflake",
          "custom",
          { ...savedSf, database: "DB2" },
          savedSf,
        );
        expect(custom.code).toContain("GRANT USAGE ON DATABASE DB2");
        expect(custom.code).not.toContain("GRANT USAGE ON WAREHOUSE");
        expect(custom.code).not.toContain("GRANT CREATE SCHEMA");

        const ef = updateOf(
          "snowflake",
          "event_forwarder",
          { ...savedSf, database: "DB2" },
          savedSf,
        );
        expect(ef.code).toContain("GRANT CREATE SCHEMA ON DATABASE DB2");
        expect(ef.code).toContain("CREATE SCHEMA IF NOT EXISTS DB2.EVENTS;");
      });

      it("event forwarder: schema change repeats only the write grants", () => {
        const update = updateOf(
          "snowflake",
          "event_forwarder",
          { ...savedSf, schema: "EVENTS2" },
          savedSf,
        );
        expect(update.description).toContain("The schema changed.");
        expect(update.code).toContain(
          "CREATE SCHEMA IF NOT EXISTS DB.EVENTS2;",
        );
        expect(update.code).not.toContain("GRANT USAGE ON DATABASE");
      });

      it("role change creates the role and grants it everything", () => {
        const update = updateOf(
          "snowflake",
          "custom",
          { ...savedSf, role: "NEW_ROLE" },
          savedSf,
        );
        expect(update.code).toContain("CREATE ROLE IF NOT EXISTS NEW_ROLE;");
        expect(update.code).toContain("GRANT ROLE NEW_ROLE TO USER GB;");
        expect(update.code).toContain(
          "ALTER USER GB SET DEFAULT_ROLE = NEW_ROLE;",
        );
        expect(update.code).toContain("GRANT USAGE ON WAREHOUSE WH");
        expect(update.code).toContain("GRANT USAGE ON DATABASE DB");
      });

      it("event forwarder: skips the write grants when nothing changed", () => {
        const update = updateOf(
          "snowflake",
          "event_forwarder",
          savedSf,
          savedSf,
        );
        expect(update.code).not.toContain("GRANT CREATE SCHEMA");
      });
    });

    it("falls back to the create flow when the username changed", () => {
      const steps = getDataSourceSetupInstructions(
        "postgres",
        "custom",
        { ...savedPg, user: "new_user", password: "pw" },
        editing(savedPg),
      );
      const create = codeOf(steps, "Create a read-only user");
      expect(create.code).toContain('CREATE USER "new_user"');
    });

    it("ignores saved params on a new connection", () => {
      const steps = getDataSourceSetupInstructions(
        "postgres",
        "custom",
        savedPg,
        {
          existing: false,
          saved: savedPg,
        },
      );
      expect(steps[0].title).toBe("Create a read-only user");
    });
  });

  describe("network access", () => {
    it("cloud: shows the egress IP and no Docker guidance", () => {
      for (const type of ["postgres", "mysql", "mssql"] as const) {
        const network = codeOf(
          getDataSourceSetupInstructions(type, "custom", undefined, {
            cloud: true,
          }),
          "Allow network access",
        );
        expect(network.code).toContain(CLOUD_EGRESS_IP);
        expect(network.description).not.toContain("host.docker.internal");
      }
    });

    it("self-hosted: shows Docker guidance and no egress IP", () => {
      for (const type of ["postgres", "mysql", "mssql"] as const) {
        const network = codeOf(
          getDataSourceSetupInstructions(type, "custom", undefined, {
            cloud: false,
          }),
          "Allow network access",
        );
        expect(network.code).toBeUndefined();
        expect(network.description).toContain("host.docker.internal");
      }
    });
  });

  describe("event forwarder", () => {
    it("snowflake: adds write grants and, with the region still open, both IPs", () => {
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
      expect(network.codeNote).toBeUndefined();
    });

    it("lists only the chosen region's IPs with no note once the region is known", () => {
      const us = codeOf(
        getDataSourceSetupInstructions(
          "snowflake",
          "event_forwarder",
          undefined,
          {
            eventForwarderRegions: ["us-east-1"],
          },
        ),
        "Allow network access",
      );
      expect(us.code).toContain(CLOUD_EGRESS_IP);
      expect(us.code).not.toContain(EU_INGESTOR_IP);
      expect(us.codeNote).toBeUndefined();

      const eu = codeOf(
        getDataSourceSetupInstructions(
          "databricks",
          "event_forwarder",
          undefined,
          {
            eventForwarderRegions: ["eu-west-1"],
          },
        ),
        "Allow network access",
      );
      expect(eu.code).toContain(CLOUD_EGRESS_IP);
      expect(eu.code).toContain(EU_INGESTOR_IP);
      expect(eu.codeNote).toBeUndefined();
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
      expect(network.codeNote).toBeUndefined();
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
      expect(titles[titles.length - 1]).toBe("Test the connection");
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
