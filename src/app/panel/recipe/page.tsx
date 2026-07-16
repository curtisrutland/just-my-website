import { RecipeScreen } from "@/components/panel/RecipeScreen";
import { panelRecipe } from "@/lib/panel/views";

export const dynamic = "force-dynamic";

export default async function RecipePage() {
  const data = await panelRecipe();
  return <RecipeScreen data={data} renderedAt={Date.now()} />;
}
