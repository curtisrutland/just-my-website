import * as z from "zod";

/**
 * The error envelope (CONVENTIONS §3). Every error response is:
 *   { "error": { "code": "...", "message": "...", "details": { } } }
 */
export type ErrorCode = "validation_error" | "invalid_json" | "unauthorized" | "not_found";

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export const unauthorized = (message = "Missing or invalid token") =>
  errorResponse(401, "unauthorized", message);

export const notFound = (message = "Not found") => errorResponse(404, "not_found", message);

export const invalidJson = () =>
  errorResponse(400, "invalid_json", "Request body was not parseable JSON");

/** 400 validation_error with `details` mapping field-path → messages (CONVENTIONS §3). */
export function validationError(error: z.ZodError): Response {
  const { fieldErrors, formErrors } = z.flattenError(error);
  const details: Record<string, unknown> = { ...fieldErrors };
  if (formErrors.length) details._errors = formErrors;
  return errorResponse(400, "validation_error", "Document failed schema validation", details);
}

/**
 * Read and validate a JSON body in one step. On success returns the parsed value; on failure
 * returns the appropriate error Response (invalid_json or validation_error) for the route to return.
 */
export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: invalidJson() };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: validationError(parsed.error) };
  return { ok: true, data: parsed.data };
}
