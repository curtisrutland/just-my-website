import { errorResponse } from "@/lib/http/errors";
import { GarageError } from "./repo";

/** Run a garage write, mapping a refused write (`GarageError`) to its 404/409 error envelope. */
export async function garageWrite(write: () => Promise<Response>): Promise<Response> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof GarageError) return errorResponse(e.status, e.status === 404 ? "not_found" : "conflict", e.message);
    throw e;
  }
}
