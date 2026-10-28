import { z } from "zod";

const optionalNumber = z.number().finite().nonnegative().nullable().default(null);
const mealItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).nullable(),
  quantity: z.number().finite().positive().max(100),
  servingLabel: z.string().trim().min(1).max(80),
  calories: z.number().finite().nonnegative(),
  carbsGrams: z.number().finite().nonnegative(),
  fiberGrams: z.number().finite().nonnegative(),
  proteinGrams: z.number().finite().nonnegative(),
  fatGrams: z.number().finite().nonnegative(),
  saturatedFatGrams: z.number().finite().nonnegative(),
  sugarGrams: z.number().finite().nonnegative(),
  sodiumMg: z.number().finite().nonnegative(),
});

export const eventSchema = z.object({
  kind: z.enum(["glucose", "meal", "hydration", "exercise"]),
  recordedAt: z.string().datetime(),
  glucoseMgDl: optionalNumber,
  glucoseContext: z.enum(["fasting", "pre_meal", "post_meal", "bedtime", "other"]).nullable().default(null),
  foodName: z.string().trim().max(160).nullable().default(null),
  servingGrams: optionalNumber,
  calories: optionalNumber,
  carbsGrams: optionalNumber,
  fiberGrams: optionalNumber,
  proteinGrams: optionalNumber,
  fatGrams: optionalNumber,
  saturatedFatGrams: optionalNumber,
  sugarGrams: optionalNumber,
  sodiumMg: optionalNumber,
  mealDurationMinutes: optionalNumber,
  mealItems: z.array(mealItemSchema).max(40).nullable().default(null),
  fluidMl: optionalNumber,
  beverage: z.string().trim().max(80).nullable().default(null),
  exerciseType: z.enum(["aerobic", "resistance", "high_intensity", "flexibility"]).nullable().default(null),
  exerciseIntensity: z.enum(["light", "moderate", "vigorous"]).nullable().default(null),
  durationMinutes: optionalNumber,
  weightKg: optionalNumber,
  notes: z.string().trim().max(500).nullable().default(null),
}).superRefine((event, context) => {
  if (event.kind === "glucose" && (event.glucoseMgDl === null || event.glucoseMgDl < 20 || event.glucoseMgDl > 700)) {
    context.addIssue({ code: "custom", path: ["glucoseMgDl"], message: "Enter a glucose value from 20 to 700 mg/dL." });
  }
  if (event.kind === "meal" && !event.foodName) {
    context.addIssue({ code: "custom", path: ["foodName"], message: "Food name is required." });
  }
  if (event.kind === "meal" && event.mealDurationMinutes !== null && (event.mealDurationMinutes <= 0 || event.mealDurationMinutes > 240)) {
    context.addIssue({ code: "custom", path: ["mealDurationMinutes"], message: "Enter an eating duration from 1 to 240 minutes." });
  }
  if (event.kind === "hydration" && (!event.fluidMl || event.fluidMl > 10000)) {
    context.addIssue({ code: "custom", path: ["fluidMl"], message: "Enter fluid volume from 1 to 10,000 mL." });
  }
  if (event.kind === "exercise") {
    if (!event.exerciseType) context.addIssue({ code: "custom", path: ["exerciseType"], message: "Select an exercise type." });
    if (!event.exerciseIntensity) context.addIssue({ code: "custom", path: ["exerciseIntensity"], message: "Select an intensity." });
    if (!event.durationMinutes || event.durationMinutes <= 0 || event.durationMinutes > 600) {
      context.addIssue({ code: "custom", path: ["durationMinutes"], message: "Enter a duration from 1 to 600 minutes." });
    }
  }
});

export type EventInput = z.infer<typeof eventSchema>;
