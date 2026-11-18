import mongoose from "mongoose";
import type { Filter } from "mongodb";
import {
  confirmationStatuses,
  type ConfirmationInterface,
} from "shared/validators";
import {
  confirmationStatusQuery,
  toApiConfirmation,
} from "back-end/src/services/confirmations";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

// One row per stored shape, so each status's query is checked against what
// toApiConfirmation reports for the same row.
const rows = [
  { id: "pending_live", status: "pending", expiresAt: ago(-HOUR) },
  { id: "pending_overdue", status: "pending", expiresAt: ago(HOUR) },
  { id: "running_recent", status: "running", decidedAt: ago(60_000) },
  { id: "running_cut_off", status: "running", decidedAt: ago(2 * HOUR) },
  { id: "running_undecided", status: "running", decidedAt: null },
  { id: "completed", status: "completed" },
  { id: "rejected", status: "rejected" },
  { id: "expired", status: "expired" },
].map(
  (row) =>
    ({
      expiresAt: ago(HOUR),
      decidedAt: ago(HOUR),
      ...row,
    }) as ConfirmationInterface,
);

const collection = () => mongoose.connection.collection("confirmations");

describe("confirmationStatusQuery", () => {
  beforeAll(async () => {
    await connectTestMongo();
    await collection().insertMany(rows.map((row) => ({ ...row })));
  });
  afterAll(disconnectTestMongo);

  it.each(confirmationStatuses)(
    "finds exactly the rows reported as %s",
    async (status) => {
      const found = await collection()
        .find({
          $or: confirmationStatusQuery(status),
        } as Filter<ConfirmationInterface>)
        .toArray();
      expect(found.map((d) => d.id).sort()).toEqual(
        rows
          .filter((row) => toApiConfirmation(row).status === status)
          .map((row) => row.id)
          .sort(),
      );
    },
  );
});
