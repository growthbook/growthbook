import { CreateProps, UpdateProps } from "back-end/types/models";
import { interactionSnapshotInterfaceValidator } from "back-end/src/validators/interactionSnapshot";
import { z } from "zod";

export type InteractionSnapshotInterface = z.infer<
  typeof interactionSnapshotInterfaceValidator
>;

export type InteractionSnapshotConfig = InteractionSnapshotInterface["config"];

export type CreateInteractionSnapshotProps = CreateProps<InteractionSnapshotInterface>;

export type UpdateInteractionSnapshotProps = UpdateProps<InteractionSnapshotInterface>;

  export type InteractionSnapshotResult = Pick<InteractionSnapshotInterface, "jointAnalyses" | "mainAnalyses" | "unknownVariations" | "multipleExposures">;

  export type InteractionSnapshotAnalysis = z.infer<typeof experimentSnapshotAnalysisSchema>;