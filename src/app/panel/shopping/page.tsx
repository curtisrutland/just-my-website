import { ShoppingScreen } from "@/components/panel/ShoppingScreen";
import { panelShopping } from "@/lib/panel/views";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const data = await panelShopping();
  return <ShoppingScreen data={data} renderedAt={Date.now()} />;
}
