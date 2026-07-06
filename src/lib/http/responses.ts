/** Success responses shared by the token API routes. */

export const ok = <T>(data: T, init?: ResponseInit): Response => Response.json(data, init);

/** get-after-create (CONVENTIONS §7): 201 + Location + the full persisted resource. */
export const created = <T>(data: T, location: string): Response =>
  Response.json(data, { status: 201, headers: { Location: location } });

export const noContent = (): Response => new Response(null, { status: 204 });
