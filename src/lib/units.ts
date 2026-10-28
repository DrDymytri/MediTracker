export type GlucoseUnit = "mgdl" | "mmoll";

// Standard clinical conversion factor (glucose molar mass ≈ 180.16 g/mol).
const MGDL_PER_MMOLL = 18.016;

export const GLUCOSE_UNIT_STORAGE_KEY = "meditrack-glucose-unit";
export const PROFILE_NAME_STORAGE_KEY = "meditrack-profile-name";

export function isGlucoseUnit(value: string | null): value is GlucoseUnit {
  return value === "mgdl" || value === "mmoll";
}

export function glucoseUnitLabel(unit: GlucoseUnit): string {
  return unit === "mgdl" ? "mg/dL" : "mmol/L";
}

// All glucose values are stored and reasoned about in mg/dL; this only converts for display/entry.
export function mgDlToDisplay(valueMgDl: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? valueMgDl : valueMgDl / MGDL_PER_MMOLL;
}

export function displayToMgDl(value: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? value : value * MGDL_PER_MMOLL;
}

export function glucoseBounds(unit: GlucoseUnit): { min: number; max: number } {
  return { min: mgDlToDisplay(20, unit), max: mgDlToDisplay(700, unit) };
}

export function formatGlucoseValue(valueMgDl: number, unit: GlucoseUnit): string {
  return `${mgDlToDisplay(valueMgDl, unit).toFixed(3)} ${glucoseUnitLabel(unit)}`;
}

// US customary fluid ounce; canonical storage stays in mL regardless of display unit.
const ML_PER_FLOZ = 29.5735;

export function volumeUnitLabel(unit: GlucoseUnit): string {
  return unit === "mgdl" ? "fl oz" : "mL";
}

export function mlToDisplay(valueMl: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? valueMl / ML_PER_FLOZ : valueMl;
}

export function displayToMl(value: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? value * ML_PER_FLOZ : value;
}

export function volumeBounds(unit: GlucoseUnit): { min: number; max: number } {
  return { min: mlToDisplay(1, unit), max: mlToDisplay(10000, unit) };
}

// International avoirdupois pound; canonical storage stays in kg regardless of display unit.
const KG_PER_LB = 0.453592;

export function weightUnitLabel(unit: GlucoseUnit): string {
  return unit === "mgdl" ? "lb" : "kg";
}

export function kgToDisplay(valueKg: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? valueKg / KG_PER_LB : valueKg;
}

export function displayToKg(value: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? value * KG_PER_LB : value;
}

export function weightBounds(unit: GlucoseUnit): { min: number; max: number } {
  return { min: kgToDisplay(20, unit), max: kgToDisplay(300, unit) };
}
