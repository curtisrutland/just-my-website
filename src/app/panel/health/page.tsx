import { HealthScreen } from "@/components/panel/HealthScreen";
import { applyHealthDemo } from "@/lib/panel/demo";
import { panelHealth } from "@/lib/panel/views";

export const dynamic = "force-dynamic"; // always current; refreshed on demand + by the version poll

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  let data = await panelHealth();

  // Dev-only state preview (never in production): /panel/health?demo=protein-met|over|fresh|no-weight|gaining
  const demo = (await searchParams).demo;
  if (demo && process.env.NODE_ENV !== "production") {
    data = applyHealthDemo(data, demo);
  }

  return <HealthScreen data={data} renderedAt={Date.now()} />;
}
