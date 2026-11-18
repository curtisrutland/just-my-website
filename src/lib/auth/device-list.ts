/**
 * The order the devices page lists tokens in (`docs/ios-app.md` §3.3.7): a child token (a phone's
 * weigh-in token for Siri) sits directly under the token that minted it. A child whose parent isn't
 * in the list any more falls back to the top level rather than vanishing. Pure, so the page and its
 * test share it.
 */
export function underParents<T extends { id: string; parentId: string | null }>(devices: T[]): T[] {
  const ids = new Set(devices.map((d) => d.id));
  const top = devices.filter((d) => !d.parentId || !ids.has(d.parentId));
  return top.flatMap((d) => [d, ...devices.filter((c) => c.parentId === d.id)]);
}
