import { UserButton } from "@clerk/nextjs";
import { DeviceList } from "@/components/settings/DeviceList";
import { PairPhone } from "@/components/settings/PairPhone";
import { AppShell } from "@/components/shell/AppShell";
import { listDeviceTokens } from "@/lib/auth/device-tokens";
import { pairPhoneAction, revokeDeviceAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Devices (`docs/ios-app.md` §4.1) — kernel UI, not a module. Pairs a phone by QR and lists every
 * device token (the iPhone, the kitchen panel, the recipes sender) with a revoke for each.
 */
export default async function DevicesPage() {
  const devices = await listDeviceTokens();
  return (
    <AppShell routeSegment="settings/devices" activeModule="devices" navFooter={<UserButton />}>
      <PairPhone pair={pairPhoneAction} />
      <DeviceList devices={devices} revoke={revokeDeviceAction} />
    </AppShell>
  );
}
