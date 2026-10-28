export type EventKind = "glucose" | "meal" | "hydration" | "exercise";
export type GlucoseContext = "fasting" | "pre_meal" | "post_meal" | "bedtime" | "other";
export type ExerciseType = "aerobic" | "resistance" | "high_intensity" | "flexibility";
export type ExerciseIntensity = "light" | "moderate" | "vigorous";

export interface MealItem {
  id: string;
  name: string;
  brand: string | null;
  quantity: number;
  servingLabel: string;
  calories: number;
  carbsGrams: number;
  fiberGrams: number;
  proteinGrams: number;
  fatGrams: number;
  saturatedFatGrams: number;
  sugarGrams: number;
  sodiumMg: number;
}

export interface HealthEvent {
  id: number;
  kind: EventKind;
  recordedAt: string;
  glucoseMgDl: number | null;
  glucoseContext: GlucoseContext | null;
  foodName: string | null;
  servingGrams: number | null;
  calories: number | null;
  carbsGrams: number | null;
  fiberGrams: number | null;
  proteinGrams: number | null;
  fatGrams: number | null;
  saturatedFatGrams: number | null;
  sugarGrams: number | null;
  sodiumMg: number | null;
  mealDurationMinutes: number | null;
  mealItems: MealItem[] | null;
  fluidMl: number | null;
  beverage: string | null;
  exerciseType: ExerciseType | null;
  exerciseIntensity: ExerciseIntensity | null;
  durationMinutes: number | null;
  weightKg: number | null;
  notes: string | null;
}

export interface FoodResult {
  fdcId: number;
  name: string;
  brand: string | null;
  servingSize: number | null;
  servingUnit: string | null;
  calories: number;
  carbsGrams: number;
  fiberGrams: number;
  proteinGrams: number;
  fatGrams: number;
  saturatedFatGrams: number;
  sugarGrams: number;
  sodiumMg: number;
}