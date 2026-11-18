import { UserButton } from "@clerk/nextjs";
import { DeviceList } from "@/components/settings/DeviceList";
import { GrantList } from "@/components/settings/GrantList";
import { PairPhone } from "@/components/settings/PairPhone";
import { AppShell } from "@/components/shell/AppShell";
import { listDeviceTokens } from "@/lib/auth/device-tokens";
import { listGrants } from "@/lib/mcp/grants";
import { pairPhoneAction, revokeDeviceAction, revokeGrantAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Devices (`docs/ios-app.md` §4.1) — kernel UI, not a module. Pairs a phone by QR and lists every
 * device token (the iPhone, the kitchen panel, the recipes sender) with a revoke for each, then
 * every app connected through the MCP sign-in (`docs/mcp.md` §3), likewise revocable.
 */
export default async function DevicesPage() {
  const [devices, grants] = await Promise.all([listDeviceTokens(), listGrants()]);
  return (
    <AppShell routeSegment="settings/devices" activeModule="devices" navFooter={<UserButton />}>
      <PairPhone pair={pairPhoneAction} />
      <DeviceList devices={devices} revoke={revokeDeviceAction} />
      <GrantList grants={grants} revoke={revokeGrantAction} />
    </AppShell>
  );
}
