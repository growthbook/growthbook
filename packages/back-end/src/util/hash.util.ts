import md5 from "md5";

// Single definition for the settings-hash scheme used by the incremental
// refresh gate, the time-series settings-change markers, and the population
// data cache. These hashes are persisted and compared across deploys, so any
// change to the scheme (digest, key ordering, undefined handling) must be
// made here for all of them at once — a one-sided change makes stored hashes
// permanently mismatch in whichever subsystem was missed.
// Note: JSON.stringify is key-order-sensitive; callers construct the hashed
// object literally (or from a const field list) so key order is fixed.
export const hashObject = (obj: object): string => md5(JSON.stringify(obj));
