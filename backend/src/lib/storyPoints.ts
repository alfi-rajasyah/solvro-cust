import { z } from "zod";

/** Task story points: a whole number 0-100; `null` clears it. The one definition for every task write. */
export const storyPointsField = z.number().int().min(0).max(100).nullable();
