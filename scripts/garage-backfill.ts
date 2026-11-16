import "../src/lib/db/load-env"; // must be first — sets DATABASE_URL before the db client evaluates
import { rideFacts } from "../src/app/(app)/garage/facts";
import { attribute, createBike, createRideTag, listBikes, tagsForActivities } from "../src/lib/garage/repo";
import { bikeCreateSchema, rideTagCreateSchema } from "../src/lib/garage/schema";
import { listRides } from "../src/lib/rides/repo";
import type { RideView } from "../src/lib/rides/types";

/**
 * The garage's one-time initial load (docs/garage-model.md, "Initial load"). Creates the four bikes
 * and three profile rules, then tags the existing cycling rides, through the garage's own write path
 * (schema.parse → repo):
 *
 *   1. a profile rule                          → a `rule` tag (via `attribute`)
 *   2. the name or note names exactly one bike → `backfill`, "named in the ride"
 *   3. before 2026-10-01, no bike named         → Neuron 6, `backfill`, "before the Roscoe arrived"
 *   4. everything else                          → printed as Curtis's list, left untagged
 *
 *   npx tsx scripts/garage-backfill.ts           # dry run: every proposed tag and the list
 *   npx tsx scripts/garage-backfill.ts --apply   # write it
 *
 * Re-runnable: existing bikes (by nickname) are reused, already-tagged rides are skipped.
 */
const apply = process.argv.includes("--apply");

const BIKES = [
  { brand: "Canyon", model: "Neuron 6", modelYear: 2026, profiles: [] },
  { brand: "Trek", model: "Roscoe 8", modelYear: 2026, profiles: [] },
  { brand: "Sunday", model: "Model C", modelYear: 2026, profiles: ["BMX"] },
  { brand: "Trek", model: "Checkpoint ALR4", modelYear: 2026, profiles: ["GRAVEL", "Bike"] },
];

/** Words that name a bike in a ride's name or note → the bike's nickname. */
const ALIASES: [RegExp, string][] = [
  [/checkpoint|gravelking|cyclovia/i, "Checkpoint ALR4"],
  [/neuron|canyon/i, "Neuron 6"],
  [/roscoe/i, "Roscoe 8"],
  [/model c|sunday/i, "Model C"],
];
const ROSCOE_DELIVERED = "2026-10-01";

async function allRides(): Promise<RideView[]> {
  const rides: RideView[] = [];
  for (let offset = 0; ; offset += 200) {
    const { items, count } = await listRides({ limit: 200, offset });
    rides.push(...items);
    if (offset + 200 >= count) break;
  }
  return rides.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

async function main() {
  // 1. Bikes and rules.
  const existing = new Map((await listBikes({ includeRetired: true })).map((b) => [b.name.toLowerCase(), b]));
  const bikeId = new Map<string, string>();
  for (const spec of BIKES) {
    const have = existing.get(spec.model.toLowerCase());
    if (have) {
      bikeId.set(spec.model, have.id);
      console.log(`bike   exists   ${spec.model}`);
    } else if (apply) {
      const bike = await createBike(bikeCreateSchema.parse(spec));
      bikeId.set(spec.model, bike.id);
      console.log(`bike   created  ${spec.model}  rules: ${spec.profiles.join(", ") || "—"}`);
    } else {
      bikeId.set(spec.model, `(new ${spec.model})`);
      console.log(`bike   would create  ${spec.model}  rules: ${spec.profiles.join(", ") || "—"}`);
    }
  }
  const rules = new Map(BIKES.flatMap((b) => b.profiles.map((p) => [p.toLowerCase(), b.model] as const)));

  // 2. Rides.
  const rides = (await allRides()).filter((r) => r.sport === "cycling");
  const tagged = await tagsForActivities(rides.map((r) => r.id));
  const byRule: RideView[] = [];
  const byBackfill: { ride: RideView; bike: string; reason: string }[] = [];
  const list: { ride: RideView; why: string }[] = [];

  for (const ride of rides) {
    if (tagged.has(ride.id)) continue;
    if (ride.sportProfileName && rules.has(ride.sportProfileName.toLowerCase())) {
      byRule.push(ride);
      continue;
    }
    const text = `${ride.name ?? ""} ${ride.note ?? ""}`;
    const named = [...new Set(ALIASES.filter(([re]) => re.test(text)).map(([, bike]) => bike))];
    if (named.length > 1) list.push({ ride, why: `names ${named.join(" and ")}` });
    else if (named.length === 1 && named[0] === "Roscoe 8" && ride.localDate < ROSCOE_DELIVERED)
      list.push({ ride, why: `names the Roscoe before its ${ROSCOE_DELIVERED} delivery` });
    else if (named.length === 1) byBackfill.push({ ride, bike: named[0], reason: "named in the ride" });
    else if (ride.localDate < ROSCOE_DELIVERED) byBackfill.push({ ride, bike: "Neuron 6", reason: "before the Roscoe arrived" });
    else list.push({ ride, why: `${ride.sportProfileName ?? "no profile"} after ${ROSCOE_DELIVERED}, no bike named` });
  }

  const line = (r: RideView) => `${r.localDate}  ${(r.sportProfileName ?? "—").padEnd(9)} ${(r.name ?? "").slice(0, 44)}`;
  console.log(`\nrides  ${rides.length} cycling, ${tagged.size} already tagged\n`);
  for (const r of byRule) console.log(`rule      ${rules.get(r.sportProfileName!.toLowerCase())!.padEnd(16)} ${line(r)}`);
  for (const t of byBackfill) console.log(`backfill  ${t.bike.padEnd(16)} ${line(t.ride)}  (${t.reason})`);
  console.log(`\nCurtis's list (${list.length}), left untagged for /garage:`);
  for (const l of list) console.log(`          ${line(l.ride)}  (${l.why})`);

  const counts = new Map<string, number>();
  for (const r of byRule) counts.set(rules.get(r.sportProfileName!.toLowerCase())!, (counts.get(rules.get(r.sportProfileName!.toLowerCase())!) ?? 0) + 1);
  for (const t of byBackfill) counts.set(t.bike, (counts.get(t.bike) ?? 0) + 1);
  console.log(`\nsummary  ${[...counts].map(([b, n]) => `${b} ${n}`).join(" · ")} · list ${list.length}`);

  if (!apply) {
    console.log("\ndry run — nothing written. Re-run with --apply.");
    return;
  }

  // 3. Write: rules first (through attribute, so they're ordinary rule tags), then the backfill.
  const ruled = byRule.length ? await attribute(byRule.map(rideFacts)) : { tagged: [] };
  for (const t of byBackfill) {
    await createRideTag(
      rideTagCreateSchema.parse({ ...rideFacts(t.ride), bikeId: bikeId.get(t.bike)!, assignedBy: "backfill", reason: t.reason })
    );
  }
  console.log(`\nwrote ${ruled.tagged.length} rule tags and ${byBackfill.length} backfill tags.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
