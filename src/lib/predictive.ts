import type { HealthEvent } from "./types";

// Dietary fiber is not enzymatically digested/absorbed in the small intestine, so it does not
// directly drive a postprandial glucose rise the way other carbohydrate does. Subtracting it to
// get "available carbohydrate" is standard diabetes carbohydrate-counting guidance.
// Ref: Institute of Medicine Dietary Reference Intakes (fiber); Academy of Nutrition and Dietetics
// carbohydrate-counting education materials.
export function availableCarbsGrams(event: Pick<HealthEvent, "carbsGrams" | "fiberGrams">): number {
  return Math.max((event.carbsGrams ?? 0) - (event.fiberGrams ?? 0), 0);
}

// Protein and fat slow gastric emptying, which blunts and delays (but does not eliminate) the
// glucose rise from a meal's carbohydrate. The coefficients below are a bounded, illustrative
// approximation of that well-documented direction of effect, not a validated clinical formula.
// Ref: Gannon & Nuttall, Diabetes Care 2004; Collier & O'Dea, Am J Clin Nutr 1983.
export function moderationFactor(event: Pick<HealthEvent, "proteinGrams" | "fatGrams">): number {
  const dampening = (event.proteinGrams ?? 0) * 0.01 + (event.fatGrams ?? 0) * 0.012;
  return 1 - Math.min(0.35, dampening);
}

export interface MealGlucoseImpact {
  availableCarbs: number;
  moderation: number;
  lowRiseMgDl: number;
  highRiseMgDl: number;
  peakMinutes: number;
  returnMinutes: number;
}

// The 3-5 mg/dL rise per gram of available carbohydrate is a commonly cited diabetes-education
// approximation for adults not accounting for insulin, medication, or activity (derived from the
// same physiology behind insulin correction "rule of 1800/500" dosing guides). Actual response
// varies widely by individual insulin sensitivity — this is an educational estimate, not
// personalized insulin-dosing guidance. Peak (~90 min) and return-to-baseline (~3.5 hr) reflect
// ADA guidance to check glucose 1-2 hours after a meal and typical postprandial kinetics.
export function estimateMealGlucoseImpact(event: Pick<HealthEvent, "carbsGrams" | "fiberGrams" | "proteinGrams" | "fatGrams">): MealGlucoseImpact {
  const availableCarbs = availableCarbsGrams(event);
  const moderation = moderationFactor(event);
  return {
    availableCarbs,
    moderation,
    lowRiseMgDl: availableCarbs * 3 * moderation,
    highRiseMgDl: availableCarbs * 5 * moderation,
    peakMinutes: 90,
    returnMinutes: 210,
  };
}

export interface TrajectoryPoint {
  minutesFromAnchor: number;
  low: number;
  high: number;
  expected: number;
}

// Simplified triangular ramp-up/return model: rises linearly to the peak, then declines linearly
// back toward baseline. This is an educational approximation of typical postprandial glucose
// kinetics, not a pharmacokinetic simulation.
export function projectPostMealTrajectory(
  baselineMgDl: number,
  impact: MealGlucoseImpact,
  stepsMinutes: number[] = [0, 30, 60, 90, 120, 150, 180, 210],
): TrajectoryPoint[] {
  return stepsMinutes.map((minute) => {
    const rampFactor = minute <= impact.peakMinutes
      ? minute / impact.peakMinutes
      : Math.max(0, 1 - (minute - impact.peakMinutes) / (impact.returnMinutes - impact.peakMinutes));
    return {
      minutesFromAnchor: minute,
      low: baselineMgDl + impact.lowRiseMgDl * rampFactor,
      high: baselineMgDl + impact.highRiseMgDl * rampFactor,
      expected: baselineMgDl + ((impact.lowRiseMgDl + impact.highRiseMgDl) / 2) * rampFactor,
    };
  });
}

export type ForecastLevel = "none" | "watch" | "elevated";

export interface GlucoseRiskForecast {
  level: ForecastLevel;
  projectedHighMgDl: number;
  crossesKetoneThreshold: boolean;
  crossesVeryHighThreshold: boolean;
  lowHydration: boolean;
  message: string;
}

// General adult fluid-adequacy reference (~1.5 L/day) used only to flag "notably low" intake for
// the time of day; individual needs vary with body size, activity, climate, and medical conditions
// (e.g., fluid-restricted heart or kidney disease), so this is never used to recommend an amount.
export const HYDRATION_REFERENCE_ML = 1500;

// Dehydration concentrates blood glucose (a concentration measure: amount per volume of blood) and
// is mechanistically and clinically linked to worsening hyperglycemia — severe dehydration is a
// defining feature of hyperosmolar hyperglycemic state (HHS), a diabetic emergency treated with IV
// fluids. This does not compute a fluid "dose"; it only flags the combined risk pattern.
// Ref: ADA/AACE hyperosmolar hyperglycemic state management guidance.
export function forecastGlucoseRisk(trajectory: TrajectoryPoint[], todayFluidMl: number): GlucoseRiskForecast {
  const peak = trajectory.reduce((max, point) => (point.high > max.high ? point : max), trajectory[0]);
  const crossesVeryHighThreshold = peak.high >= 300;
  const crossesKetoneThreshold = peak.high >= 250;
  const lowHydration = todayFluidMl < HYDRATION_REFERENCE_ML * 0.4;

  let level: ForecastLevel = "none";
  let message = "The estimated trend stays within a typical range based on this meal and your most recent reading.";

  if (crossesVeryHighThreshold) {
    level = "elevated";
    message = "The estimated trend may reach very-high glucose levels within a few hours. Check your glucose directly to confirm, and follow your prescribed correction and sick-day plan.";
  } else if (crossesKetoneThreshold) {
    level = "watch";
    message = "The estimated trend may reach levels where checking ketones is advised. Check your glucose directly to confirm.";
  }

  if (lowHydration && (crossesKetoneThreshold || crossesVeryHighThreshold)) {
    message += " Fluid intake has been low today — dehydration can further concentrate blood glucose and is a warning sign in severe hyperglycemia. Increase fluids per your care plan unless your clinician has told you to restrict them.";
  }

  return { level, projectedHighMgDl: peak.high, crossesKetoneThreshold, crossesVeryHighThreshold, lowHydration, message };
}
