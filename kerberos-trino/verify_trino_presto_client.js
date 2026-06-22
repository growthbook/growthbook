const kerberos = require("kerberos");
const presto = require("presto-client");

const servicePrincipal = "trino@trino.docker.internal";
const clientPrincipal = "growthbook@TEST.LOCAL";

(async () => {
  try {
    console.log("Initializing Kerberos client...");
    let startTime = performance.now();
    const client = await kerberos.initializeClient(servicePrincipal, {
      mechOID: kerberos.GSS_MECH_OID_KRB5,
      principal: clientPrincipal,
    });
    let endTime = performance.now();
    console.log(`initializeClient took ${(endTime - startTime).toFixed(2)}ms`);

    try {
      console.log("Generating token...");
      startTime = performance.now();
      const token = await client.step("");
      endTime = performance.now();
      console.log(`client.step took ${(endTime - startTime).toFixed(2)}ms`);
      console.log("Token generated:", token.substring(0, 20) + "...");
      // const validResponse = await makeRequest(token);
      // console.log("validResponse", validResponse);
    } catch (error) {
      console.error("Error making request with valid token:", error);
    }

    try {
      console.log("Initializing Kerberos client...");
      startTime = performance.now();
      const client = await kerberos.initializeClient(servicePrincipal, {
        mechOID: kerberos.GSS_MECH_OID_KRB5,
        principal: clientPrincipal,
      });
      endTime = performance.now();
      console.log(
        `initializeClient took ${(endTime - startTime).toFixed(2)}ms`,
      );
      console.log("Generating token...");
      startTime = performance.now();
      const token = await client.step("");
      endTime = performance.now();
      console.log(`client.step took ${(endTime - startTime).toFixed(2)}ms`);
      console.log("Token generated:", token.substring(0, 20) + "...");
      // const validResponse = await makeRequest(token);
      // console.log("validResponse", validResponse);
    } catch (error) {
      console.error("Error making request with valid token:", error);
    }

    try {
      console.log("Initializing Kerberos client...");
      startTime = performance.now();
      const client = await kerberos.initializeClient(servicePrincipal, {
        mechOID: kerberos.GSS_MECH_OID_KRB5,
        principal: clientPrincipal,
      });
      endTime = performance.now();
      console.log(
        `initializeClient took ${(endTime - startTime).toFixed(2)}ms`,
      );
      console.log("Generating token...");
      startTime = performance.now();
      const token = await client.step("");
      endTime = performance.now();
      console.log(`client.step took ${(endTime - startTime).toFixed(2)}ms`);
      console.log("Token generated:", token.substring(0, 20) + "...");
      // const validResponse = await makeRequest(token);
      // console.log("validResponse", validResponse);
    } catch (error) {
      console.error("Error making request with valid token:", error);
    }
  } catch (error) {
    console.error("General error:", error);
  }
})();

// (async () => {
//   try {
//     console.log("Initializing Kerberos client...");
//     const client = await kerberos.initializeClient(servicePrincipal, {
//       mechOID: kerberos.GSS_MECH_OID_KRB5,
//       principal: clientPrincipal,
//     });

//     console.log("Client initialized. Generating token...");
//     const token = await client.step("");

//     console.log("Token generated:", token.substring(0, 20) + "...");

//     try {
//       const noTokenResponse = await makeRequest(null);
//       console.log("noTokenResponse", noTokenResponse);
//     } catch (error) {
//       console.error("Error making request with no token:", error);
//     }
//     try {
//       const invalidResponse = await makeRequest("invalid token");
//       console.log("invalidResponse", invalidResponse);
//     } catch (error) {
//       console.error("Error making request with invalid token:", error);
//     }
//     try {
//       const validResponse = await makeRequest(token);
//       console.log("validResponse", validResponse);
//     } catch (error) {
//       console.error("Error making request with valid token:", error);
//     }
//     try {
//       const reuseTokenResponse = await makeRequest(token);
//       console.log("reuseTokenResponse", reuseTokenResponse);
//     } catch (error) {
//       console.error("Error making request with reused token:", error);
//     }
//   } catch (error) {
//     console.error("General error:", error);
//   }
// })();

function makeRequest(token) {
  const configOptions = {
    engine: "trino",
    host: "trino.docker.internal",
    port: 8443,
    user: "growthbook",
    source: "growthbook",
    schema: "",
    catalog: "",
    timeout: 0,
    checkInterval: 500,
    ssl: {
      rejectUnauthorized: false,
    },
  };
  if (token) {
    configOptions.custom_auth = `Negotiate ${token}`;
  }
  const client = new presto.Client(configOptions);

  return new Promise((resolve, reject) => {
    let cols;
    const rows = [];
    const statistics = {};

    const executeOptions = {
      query: "SELECT 1",
      catalog: "",
      schema: "",
      columns: (error, data) => {
        if (error) return;
        cols = data.map((d) => d.name);
      },
      error: (error) => {
        reject(error);
      },
      data: (error, data) => {
        console.log("data", data);
        if (error) return;

        data.forEach((d) => {
          const row = {};
          d.forEach((v, i) => {
            row[cols[i]] = v;
          });
          rows.push(row);
        });
      },
      success: () => {
        resolve({
          rows,
          columns: cols.map((col) => ({
            name: col,
          })),
          statistics,
        });
      },
    };

    // For Kerberos auth, we need to set the user in executeOptions
    // which sets the X-Trino-User header
    // Note: This requires an impersonation rule in access-control-rules.json
    // allowing growthbook@TEST.LOCAL to impersonate growthbook
    if (token) {
      executeOptions.user = "growthbook";
    }

    client.execute(executeOptions);
  });
}
