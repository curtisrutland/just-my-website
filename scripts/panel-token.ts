import "../src/lib/db/load-env"; // must be first — sets DATABASE_URL before the db client evaluates
import { KITCHEN_PANEL_SCOPES, RECIPES_SERVICE_SCOPES } from "../src/lib/panel/scopes";
import { createDeviceToken } from "../src/lib/panel/tokens";

/**
 * Mint a panel credential and print the RAW token ONCE (it is never retrievable afterward).
 *
 *   npm run panel:token -- kitchen-panel     # panel:read + write:shopping + write:daytype
 *   npm run panel:token -- justmy-recipes    # panel:write:recipe (the send-to-panel service token)
 *
 * Or with an explicit name:  npm run panel:token -- justmy-recipes staging-sender
 */
async function main() {
  const kind = process.argv[2];
  const nameArg = process.argv[3];

  let scopes;
  let defaultName;
  if (kind === "kitchen-panel") {
    scopes = KITCHEN_PANEL_SCOPES;
    defaultName = "kitchen-panel";
  } else if (kind === "justmy-recipes") {
    scopes = RECIPES_SERVICE_SCOPES;
    defaultName = "justmy-recipes";
  } else {
    console.error("Usage: npm run panel:token -- <kitchen-panel|justmy-recipes> [name]");
    process.exit(1);
    return;
  }

  const { raw, id, name, scopes: granted } = await createDeviceToken({
    name: nameArg ?? defaultName,
    scopes,
  });

  console.log("\n  Device token minted — copy the raw value now; it is not stored and cannot be shown again.\n");
  console.log(`    name:   ${name}`);
  console.log(`    id:     ${id}`);
  console.log(`    scopes: ${granted.join(", ")}`);
  console.log(`\n    token:  ${raw}\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
