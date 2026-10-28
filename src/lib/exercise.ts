import type { ExerciseIntensity, ExerciseType } from "./types";

// MET (metabolic equivalent) values for representative activities of each type/intensity,
// drawn from the Compendium of Physical Activities (Ainsworth et al., Med Sci Sports Exerc 2011).
const MET_TABLE: Record<ExerciseType, Record<ExerciseIntensity, number>> = {
  aerobic: { light: 3.0, moderate: 5.0, vigorous: 8.0 },
  resistance: { light: 3.0, moderate: 4.5, vigorous: 6.0 },
  high_intensity: { light: 5.0, moderate: 8.0, vigorous: 12.0 },
  flexibility: { light: 2.0, moderate: 2.5, vigorous: 3.0 },
};

export interface ExerciseEnergy {
  met: number;
  caloriesBurned: number;
}

const DEFAULT_BODY_WEIGHT_KG = 70;

// Standard ACSM metabolic calorie formula: kcal/min = (MET x 3.5 x weight(kg)) / 200.
export function estimateExerciseEnergy(type: ExerciseType, intensity: ExerciseIntensity, durationMinutes: number, weightKg: number | null): ExerciseEnergy {
  const met = MET_TABLE[type][intensity];
  const effectiveWeight = weightKg && weightKg > 0 ? weightKg : DEFAULT_BODY_WEIGHT_KG;
  const caloriesBurned = ((met * 3.5 * effectiveWeight) / 200) * durationMinutes;
  return { met, caloriesBurned };
}

export type GlucoseDirection = "lowers" | "mixed" | "minimal";

export interface ExerciseGlucoseImpact {
  direction: GlucoseDirection;
  lowMgDl: number;
  highMgDl: number;
  windowHours: number;
  explanation: string;
}

// Aerobic exercise increases insulin-independent, contraction-mediated (GLUT4) muscle glucose
// uptake and typically lowers blood glucose during and for hours afterward.
// Ref: Richter & Hargreaves, "Exercise, GLUT4, and Skeletal Muscle Glucose Uptake," Physiol Rev 2013.
// High-intensity/anaerobic effort triggers a catecholamine (epinephrine/norepinephrine) surge that
// raises hepatic glucose output and can transiently RAISE glucose before a later insulin-sensitizing
// drop. Ref: Marliss & Vranic, "Intense Exercise Has Unique Effects on Both Insulin Release and Its
// Roles in Glucoregulation," Diabetes 2002.
// Resistance training has a smaller acute effect but improves insulin sensitivity for roughly
// 24-48 hours afterward. Ref: Colberg et al., "Physical Activity/Exercise and Diabetes: A Position
// Statement of the American Diabetes Association," Diabetes Care 2016.
export function estimateExerciseGlucoseImpact(type: ExerciseType, durationMinutes: number, energy: ExerciseEnergy): ExerciseGlucoseImpact {
  const metMinutes = energy.met * durationMinutes;

  if (type === "high_intensity") {
    return {
      direction: "mixed",
      lowMgDl: metMinutes * 0.05,
      highMgDl: metMinutes * 0.15,
      windowHours: 2,
      explanation: "High-intensity effort can transiently raise glucose via adrenaline-driven liver glucose release, often followed by a larger drop over the next several hours as insulin sensitivity improves.",
    };
  }
  if (type === "flexibility") {
    return {
      direction: "minimal",
      lowMgDl: 0,
      highMgDl: metMinutes * 0.05,
      windowHours: 1,
      explanation: "Low-intensity flexibility work has minimal acute effect on glucose.",
    };
  }

  const isAerobic = type === "aerobic";
  return {
    direction: "lowers",
    lowMgDl: metMinutes * (isAerobic ? 0.15 : 0.08),
    highMgDl: metMinutes * (isAerobic ? 0.35 : 0.2),
    windowHours: isAerobic ? 4 : 24,
    explanation: isAerobic
      ? "Aerobic activity increases insulin-independent muscle glucose uptake, typically lowering glucose during and for a few hours after exercise."
      : "Resistance training modestly lowers glucose acutely and improves insulin sensitivity for up to 24-48 hours afterward.",
  };
}

export type PreExerciseLevel = "low" | "caution" | "ready" | "monitor" | "unsafe";

export interface PreExerciseGuidance {
  level: PreExerciseLevel;
  message: string;
}

// ADA/ACSM pre-exercise blood glucose guidance (Colberg et al., Diabetes Care 2016, Table 3).
export function preExerciseGuidance(glucoseMgDl: number): PreExerciseGuidance {
  if (glucoseMgDl < 90) {
    return { level: "low", message: "Below 90 mg/dL: eat 15-30 g of fast-acting carbohydrate before exercising and recheck." };
  }
  if (glucoseMgDl < 126) {
    return { level: "caution", message: "90-125 mg/dL: a small carbohydrate snack may be advisable depending on exercise type and duration." };
  }
  if (glucoseMgDl <= 180) {
    return { level: "ready", message: "126-180 mg/dL: generally a safe range to begin exercise." };
  }
  if (glucoseMgDl <= 270) {
    return { level: "monitor", message: "181-270 mg/dL: usually safe to begin, but monitor levels, especially with type 1 diabetes." };
  }
  return { level: "unsafe", message: "Above 270 mg/dL: check ketones before exercising. Avoid vigorous activity if ketones are present, and follow your care plan." };
}

// Aerobic/resistance exercise can lower glucose for hours afterward, and this delayed-onset drop
// is a well-documented cause of overnight hypoglycemia, particularly with insulin or sulfonylureas.
// Ref: ADA/ACSM position statement (Colberg et al., Diabetes Care 2016).
export function exerciseHypoglycemiaCaution(type: ExerciseType, durationMinutes: number): string | null {
  if (type === "flexibility" || durationMinutes < 20) return null;
  return "Extended or moderate-to-vigorous exercise can lower glucose for hours afterward, raising hypoglycemia risk \u2014 including overnight \u2014 especially if you use insulin or a sulfonylurea. Recheck glucose after exercising.";
}
