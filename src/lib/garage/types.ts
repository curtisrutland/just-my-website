import type * as z from "zod";
import type { attributeResultSchema, bikeViewSchema, rideTagViewSchema } from "./schema";

/** Garage domain + response-contract types, shared by the repo and the UI. Inferred from the view
 *  schemas in `schema.ts`, so the repo's builders are type-checked against the published contract. */

export type BikeView = z.infer<typeof bikeViewSchema>;
export type RideTagView = z.infer<typeof rideTagViewSchema>;
export type AttributeResult = z.infer<typeof attributeResultSchema>;
