const https = require("https");
const kerberos = require("kerberos");

const servicePrincipal = "trino@trino.docker.internal";
const clientPrincipal = "growthbook@TEST.LOCAL";

async function getNewToken() {
  const client = await kerberos.initializeClient(servicePrincipal, {
    mechOID: kerberos.GSS_MECH_OID_KRB5,
    principal: clientPrincipal,
  });
  return await client.step("");
}

async function executeTrinoQuery(query) {
  const token = await getNewToken();
  const postData = query;

  const options = {
    hostname: "trino.docker.internal",
    port: 8443,
    path: "/v1/statement",
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-Trino-User": "growthbook",
      "X-Trino-Catalog": "memory",
      "X-Trino-Schema": "default",
      Authorization: `Negotiate ${token}`,
    },
    rejectUnauthorized: false,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

async function waitForQuery(nextUri) {
  const token = await getNewToken();
  return new Promise((resolve, reject) => {
    const url = new URL(nextUri);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        Authorization: `Negotiate ${token}`,
      },
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.end();
  });
}

async function runQueryToCompletion(query) {
  console.log(`Executing: ${query.substring(0, 100)}...`);

  let response = await executeTrinoQuery(query);

  while (response.nextUri) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    response = await waitForQuery(response.nextUri);

    if (response.stats) {
      process.stdout.write(`\rProgress: ${response.stats.progressPercentage?.toFixed(1) || 0}%`);
    }
  }

  console.log("");

  if (response.error) {
    throw new Error(`Query failed: ${response.error.message}`);
  }

  return response;
}

(async () => {
  try {
    console.log("Kerberos authentication configured\n");

    // Create schema
    console.log("1. Creating schema...");
    await runQueryToCompletion("CREATE SCHEMA IF NOT EXISTS memory.default");

    // Drop table if exists
    console.log("\n2. Dropping existing table if exists...");
    try {
      await runQueryToCompletion("DROP TABLE IF EXISTS memory.default.large_sample_data");
    } catch (e) {
      console.log("Table doesn't exist yet");
    }

    // Create large table with sample data
    console.log("\n3. Creating large sample table (500,000 rows)...");
    console.log("This will take 1-2 minutes...\n");

    const createQuery = `
      CREATE TABLE memory.default.large_sample_data AS
      WITH numbers AS (
        SELECT (batch * 10000 + n) as id
        FROM UNNEST(sequence(0, 49)) as t1(batch)
        CROSS JOIN UNNEST(sequence(1, 10000)) as t2(n)
      )
      SELECT
        id,
        to_hex(md5(to_utf8(cast(id as varchar)))) as hash1,
        to_hex(md5(to_utf8(cast(id * 2 as varchar)))) as hash2,
        to_hex(md5(to_utf8(cast(id * 3 as varchar)))) as hash3,
        to_hex(md5(to_utf8(cast(id * 4 as varchar)))) as hash4,
        random() * 1000000 as num1,
        random() * 1000000 as num2,
        random() * 1000000 as num3,
        from_unixtime(cast(random() * 1640000000 as bigint)) as date1,
        CASE
          WHEN random() < 0.33 THEN 'Category A'
          WHEN random() < 0.66 THEN 'Category B'
          ELSE 'Category C'
        END as category,
        repeat('PADDING_', 100) as padding
      FROM numbers
    `;

    await runQueryToCompletion(createQuery);

    // Get row count
    console.log("\n4. Verifying data...");
    const countResult = await runQueryToCompletion(
      "SELECT COUNT(*) FROM memory.default.large_sample_data"
    );
    console.log(`✓ Table created with ${countResult.data?.[0]?.[0] || "N/A"} rows`);

    console.log("\n=== SUCCESS! ===");
    console.log("\nTable: memory.default.large_sample_data");
    console.log("\nExample expensive queries to test:");
    console.log("1. SELECT category, AVG(num1), COUNT(*) FROM memory.default.large_sample_data GROUP BY category");
    console.log("2. SELECT * FROM memory.default.large_sample_data ORDER BY num1 LIMIT 1000");
    console.log("3. SELECT hash1, COUNT(*) FROM memory.default.large_sample_data GROUP BY hash1 HAVING COUNT(*) > 1");

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
})();
