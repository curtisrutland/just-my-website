import { HealthScreen } from "@/components/panel/HealthScreen";
import { panelHealth } from "@/lib/panel/views";

export const dynamic = "force-dynamic"; // always current; refreshed on demand + by the version poll

export default async function HealthPage() {
  const data = await panelHealth();
  return <HealthScreen data={data} renderedAt={Date.now()} />;
}
