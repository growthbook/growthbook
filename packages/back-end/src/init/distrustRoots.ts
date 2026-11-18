import tls from "tls";
import { X509Certificate } from "crypto";

// Node's bundled root store ignores OS ca-certificates updates, so drop removed roots here until Node ships them.
const DISTRUSTED_FINGERPRINTS = new Set([
  // emSign ECC Root CA - G3: cross-signs the compromised eMudhra intermediates (Oct 2026)
  "86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B",
]);

// Added in Node 22.19 / 24.5 (and missing from our @types/node); older Node keeps the stock store.
const { getCACertificates, setDefaultCACertificates } = tls as unknown as {
  getCACertificates?: (type: "default") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

if (getCACertificates && setDefaultCACertificates) {
  setDefaultCACertificates(
    getCACertificates("default").filter(
      (pem) =>
        !DISTRUSTED_FINGERPRINTS.has(new X509Certificate(pem).fingerprint256),
    ),
  );
}
