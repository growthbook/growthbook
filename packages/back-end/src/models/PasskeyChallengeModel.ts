import mongoose from "mongoose";

export type PasskeyChallengeType = "registration" | "authentication";

interface PasskeyChallengeInterface {
  challenge: string;
  type: PasskeyChallengeType;
  // Null for sign-in, which doesn't know the user until the passkey is verified
  userId: string | null;
  createdAt: Date;
}

const CHALLENGE_TTL_SECONDS = 5 * 60;

const passkeyChallengeSchema = new mongoose.Schema({
  challenge: {
    type: String,
    unique: true,
  },
  type: String,
  userId: String,
  createdAt: {
    type: Date,
    expires: CHALLENGE_TTL_SECONDS,
  },
});

const PasskeyChallengeModel = mongoose.model<PasskeyChallengeInterface>(
  "PasskeyChallenge",
  passkeyChallengeSchema,
);

export async function savePasskeyChallenge(
  challenge: string,
  type: PasskeyChallengeType,
  userId: string | null,
) {
  const doc: PasskeyChallengeInterface = {
    challenge,
    type,
    userId,
    createdAt: new Date(),
  };
  await PasskeyChallengeModel.create(doc);
}

// Deletes the challenge so it can only be used once, even if verification fails
export async function consumePasskeyChallenge(
  challenge: string,
  type: PasskeyChallengeType,
  userId: string | null,
): Promise<boolean> {
  const doc = await PasskeyChallengeModel.findOneAndDelete({
    challenge: { $eq: String(challenge) },
    type,
    userId,
  });
  if (!doc) return false;

  // Mongo only removes expired documents about once a minute
  return Date.now() - doc.createdAt.getTime() < CHALLENGE_TTL_SECONDS * 1000;
}
