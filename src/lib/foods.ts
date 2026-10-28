import type { FoodResult } from "./types";

interface UsdaNutrient { nutrientName: string; value: number }
interface UsdaFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaNutrient[];
}

const nutrient = (food: UsdaFood, names: string[]) =>
  food.foodNutrients?.find((item) => names.includes(item.nutrientName))?.value ?? 0;

// Called directly from the device: the only data sent off-phone is the food search text.
export async function searchFoods(query: string): Promise<FoodResult[]> {
  const apiKey = process.env.NEXT_PUBLIC_USDA_API_KEY || "DEMO_KEY";
  if (!navigator.onLine) throw new Error("Food search needs an internet connection. You can still type values in manually.");
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=8`);
  if (response.status === 429) throw new Error("USDA search limit reached. Try again in a little while.");
  if (!response.ok) throw new Error("USDA FoodData Central is unavailable.");

  const payload = await response.json() as { foods: UsdaFood[] };
  return payload.foods.map((food) => ({
    fdcId: food.fdcId,
    name: food.description,
    brand: food.brandOwner ?? null,
    servingSize: food.servingSize ?? null,
    servingUnit: food.servingSizeUnit ?? null,
    calories: nutrient(food, ["Energy"]),
    carbsGrams: nutrient(food, ["Carbohydrate, by difference"]),
    fiberGrams: nutrient(food, ["Fiber, total dietary"]),
    proteinGrams: nutrient(food, ["Protein"]),
    fatGrams: nutrient(food, ["Total lipid (fat)"]),
    saturatedFatGrams: nutrient(food, ["Fatty acids, total saturated"]),
    sugarGrams: nutrient(food, ["Sugars, total including NLEA", "Total Sugars"]),
    sodiumMg: nutrient(food, ["Sodium, Na"]),
  }));
}
