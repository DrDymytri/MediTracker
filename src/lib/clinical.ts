import type { GlucoseContext, HealthEvent } from "./types";
import { formatGlucoseValue, type GlucoseUnit } from "./units";

export type ClinicalLevel = "target" | "watch" | "high" | "urgent";

export interface ClinicalAssessment {
  level: ClinicalLevel;
  label: string;
  guidance: string;
}

export function assessGlucose(value: number, context: GlucoseContext | null, unit: GlucoseUnit = "mgdl"): ClinicalAssessment {
  if (value < 54) {
    return {
      level: "urgent",
      label: "Severely low",
      guidance: "Treat immediately with fast-acting glucose. If unable to swallow, confused, unconscious, or not improving, use prescribed glucagon and call emergency services.",
    };
  }

  if (value < 70) {
    return {
      level: "urgent",
      label: "Low",
      guidance: `Take 15.000 g of fast-acting carbohydrate and recheck in 15.000 minutes. Repeat if still below ${formatGlucoseValue(70, unit)}.`,
    };
  }

  if (value >= 300) {
    return {
      level: "urgent",
      label: "Very high",
      guidance: "Follow your prescribed correction and sick-day plan. Check ketones. Seek emergency care for moderate/high ketones, vomiting, trouble breathing, confusion, or inability to keep fluids down.",
    };
  }

  if (value >= 250) {
    return {
      level: "high",
      label: "Check ketones",
      guidance: "Check ketones, especially if ill, and follow your clinician's correction plan. Contact your care team if the level persists or ketones are present.",
    };
  }

  const isMealTarget = context === "fasting" || context === "pre_meal";
  const upperTarget = context === "post_meal" ? 180 : isMealTarget ? 130 : 180;
  const lowerTarget = isMealTarget ? 80 : 70;

  if (value < lowerTarget) {
    return { level: "watch", label: "Below target", guidance: "Monitor for symptoms and follow your individualized care plan." };
  }

  if (value <= upperTarget) {
    return { level: "target", label: "In target", guidance: "Within the common ADA target for this context. Personal goals may differ." };
  }

  return {
    level: "high",
    label: "Above target",
    guidance: "Record contributing factors and follow your individualized care plan. Discuss repeated patterns with your care team.",
  };
}

export function assessMeal(event: Pick<HealthEvent, "carbsGrams" | "fiberGrams" | "proteinGrams" | "saturatedFatGrams" | "sodiumMg">): ClinicalAssessment {
  const carbs = event.carbsGrams ?? 0;
  const fiber = event.fiberGrams ?? 0;
  const protein = event.proteinGrams ?? 0;
  const saturatedFat = event.saturatedFatGrams ?? 0;
  const sodium = event.sodiumMg ?? 0;
  let score = 0;

  if (fiber >= 5) score += 2;
  else if (fiber >= 3) score += 1;
  if (protein >= 10) score += 1;
  if (carbs > 60) score -= 2;
  else if (carbs > 45) score -= 1;
  if (saturatedFat > 5) score -= 1;
  if (sodium > 800) score -= 1;

  if (score >= 2) {
    return { level: "target", label: "Supportive balance", guidance: "This serving pairs carbohydrate with meaningful fiber and/or protein, which may support a steadier response." };
  }
  if (score < 0) {
    return { level: "high", label: "Higher impact", guidance: "This serving has a higher carbohydrate, saturated-fat, or sodium load. Consider a smaller portion or pairing with fiber and lean protein." };
  }
  return { level: "watch", label: "Mixed balance", guidance: "Response varies by person. Compare this meal with your glucose before and 1–2 hours after eating." };
}

export function estimatedA1c(averageGlucose: number): number {
  return (averageGlucose + 46.7) / 28.7;
}