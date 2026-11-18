"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { originFrom } from "@/lib/auth/pairing";
import { createAuthorization } from "@/lib/mcp/grants";
import { AUTHORIZE_FIELDS, parseAuthorizeRequest, redirectWith } from "@/lib/mcp/oauth";

/**
 * Approve or deny an authorization request (`docs/mcp.md` §2). The form's fields are the request's
 * own parameters, so they are validated again here exactly as on the page: nothing is trusted for
 * having been rendered. Only an approval by a signed-in session mints a code.
 */
export async function decideAction(formData: FormData): Promise<never> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const params = Object.fromEntries(AUTHORIZE_FIELDS.map((name) => [name, formData.get(name)?.toString()]));
  const origin = originFrom(await headers());
  const parsed = parseAuthorizeRequest(params, origin);
  if (!parsed.ok) {
    if (parsed.problem.kind === "page") throw new Error(parsed.problem.message);
    const { redirectUri, state, error, description } = parsed.problem;
    redirect(redirectWith(redirectUri, { error, error_description: description, state, iss: origin }));
  }

  const { request } = parsed;
  if (formData.get("decision") !== "approve") {
    redirect(redirectWith(request.redirectUri, { error: "access_denied", error_description: "The request was denied.", state: request.state, iss: origin }));
  }
  const { code } = await createAuthorization(request);
  redirect(redirectWith(request.redirectUri, { code, state: request.state, iss: origin }));
}
