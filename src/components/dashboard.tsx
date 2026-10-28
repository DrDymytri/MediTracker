"use client";

import { useEffect, useState } from "react";
import { format, isToday, parseISO, subDays } from "date-fns";
import { Activity, AlertTriangle, Apple, ChevronRight, Download, Droplets, Dumbbell, Flame, HeartPulse, History as HistoryIcon, LayoutDashboard, Plus, Search, ShieldCheck, Trash2, Upload, Utensils, X } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { assessGlucose, assessMeal, estimatedA1c } from "@/lib/clinical";
import { searchFoods as searchFoodDatabase } from "@/lib/foods";
import { createEvent, deleteEvent, exportBackup, importBackup, listEvents, listRestorePoints, requestPersistentStorage, restoreFromPoint, takeSnapshot, type RestorePoint } from "@/lib/store";
import { estimateExerciseEnergy, estimateExerciseGlucoseImpact, exerciseHypoglycemiaCaution, preExerciseGuidance } from "@/lib/exercise";
import { estimateMealGlucoseImpact, forecastGlucoseRisk, projectPostMealTrajectory } from "@/lib/predictive";
import { GLUCOSE_UNIT_STORAGE_KEY, PROFILE_NAME_STORAGE_KEY, displayToKg, displayToMgDl, displayToMl, glucoseBounds, glucoseUnitLabel, isGlucoseUnit, kgToDisplay, mgDlToDisplay, mlToDisplay, volumeBounds, volumeUnitLabel, weightBounds, weightUnitLabel, type GlucoseUnit } from "@/lib/units";
import type { EventKind, ExerciseIntensity, ExerciseType, FoodResult, GlucoseContext, HealthEvent, MealItem } from "@/lib/types";

interface ChartPoint {
  timestamp: number;
  time: string;
  value?: number;
  projLow?: number;
  projHigh?: number;
  projExpected?: number;
  projBand?: number;
  exerciseLow?: number;
  exerciseHigh?: number;
  exerciseExpected?: number;
  exerciseBand?: number;
  netExpected?: number;
  hydrationMarker?: number;
  hydrationMl?: number;
}

function mealProjectionAt(baselineMgDl: number, lowRiseMgDl: number, highRiseMgDl: number, elapsedMinutes: number, peakMinutes: number, returnMinutes: number) {
  const rampFactor = elapsedMinutes <= peakMinutes
    ? Math.max(0, elapsedMinutes) / peakMinutes
    : Math.max(0, 1 - (elapsedMinutes - peakMinutes) / (returnMinutes - peakMinutes));
  return {
    low: baselineMgDl + lowRiseMgDl * rampFactor,
    high: baselineMgDl + highRiseMgDl * rampFactor,
    expected: baselineMgDl + ((lowRiseMgDl + highRiseMgDl) / 2) * rampFactor,
  };
}

function exerciseProjectionAt(baselineMgDl: number, direction: "lowers" | "mixed" | "minimal", lowMgDl: number, highMgDl: number, elapsedHours: number, windowHours: number) {
  const progress = Math.min(1, Math.max(0, elapsedHours / windowHours));
  const recoveryFactor = elapsedHours <= windowHours * 0.65 ? progress / 0.65 : Math.max(0, 1 - (elapsedHours - windowHours * 0.65) / (windowHours * 0.35));
  if (direction === "mixed" && elapsedHours <= 0.5) {
    const riseFactor = elapsedHours / 0.5;
    return { low: baselineMgDl + lowMgDl * riseFactor, high: baselineMgDl + highMgDl * riseFactor, expected: baselineMgDl + ((lowMgDl + highMgDl) / 2) * riseFactor };
  }
  const dropStart = direction === "mixed" ? 0.5 : 0;
  const dropElapsed = Math.max(0, elapsedHours - dropStart);
  const dropProgress = Math.min(1, dropElapsed / Math.max(0.5, windowHours - dropStart));
  const dropFactor = direction === "minimal" ? progress : Math.max(recoveryFactor, dropProgress * 0.65);
  return {
    low: Math.max(0, baselineMgDl - highMgDl * dropFactor),
    high: Math.max(0, baselineMgDl - lowMgDl * dropFactor),
    expected: Math.max(0, baselineMgDl - ((lowMgDl + highMgDl) / 2) * dropFactor),
  };
}

const emptyEvent = (kind: EventKind): Omit<HealthEvent, "id"> => ({
  kind, recordedAt: new Date().toISOString(), glucoseMgDl: null,
  glucoseContext: kind === "glucose" ? "other" : null, foodName: null,
  servingGrams: null, calories: null, carbsGrams: null, fiberGrams: null,
  proteinGrams: null, fatGrams: null, saturatedFatGrams: null, sugarGrams: null,
  sodiumMg: null, mealDurationMinutes: kind === "meal" ? 20 : null, mealItems: kind === "meal" ? [] : null,
  fluidMl: null, beverage: null,
  exerciseType: kind === "exercise" ? "aerobic" : null, exerciseIntensity: kind === "exercise" ? "moderate" : null,
  durationMinutes: null, weightKg: null, notes: null,
});
const formatNumeric = (value: number | null | undefined) => value === null || value === undefined ? "—" : value.toFixed(3);
const LAST_BACKUP_STORAGE_KEY = "meditrack-last-backup";
const BACKUP_REMINDER_DAYS = 7;
const formatGlucose = (valueMgDl: number | null | undefined, unit: GlucoseUnit) => valueMgDl === null || valueMgDl === undefined ? "—" : mgDlToDisplay(valueMgDl, unit).toFixed(3);
const scaleNutrient = (value: number, quantity: number) => value * quantity;

function mealTotals(items: MealItem[]) {
  return items.reduce((totals, item) => ({
    calories: totals.calories + scaleNutrient(item.calories, item.quantity),
    carbsGrams: totals.carbsGrams + scaleNutrient(item.carbsGrams, item.quantity),
    fiberGrams: totals.fiberGrams + scaleNutrient(item.fiberGrams, item.quantity),
    proteinGrams: totals.proteinGrams + scaleNutrient(item.proteinGrams, item.quantity),
    fatGrams: totals.fatGrams + scaleNutrient(item.fatGrams, item.quantity),
    saturatedFatGrams: totals.saturatedFatGrams + scaleNutrient(item.saturatedFatGrams, item.quantity),
    sugarGrams: totals.sugarGrams + scaleNutrient(item.sugarGrams, item.quantity),
    sodiumMg: totals.sodiumMg + scaleNutrient(item.sodiumMg, item.quantity),
  }), { calories: 0, carbsGrams: 0, fiberGrams: 0, proteinGrams: 0, fatGrams: 0, saturatedFatGrams: 0, sugarGrams: 0, sodiumMg: 0 });
}

function applyMealItems(current: Omit<HealthEvent, "id">, items: MealItem[]): Omit<HealthEvent, "id"> {
  const totals = mealTotals(items);
  return {
    ...current,
    mealItems: items,
    foodName: items.length ? items.map((item) => `${formatNumeric(item.quantity)}x ${item.name}`).join(" + ").slice(0, 160) : current.foodName,
    servingGrams: null,
    ...totals,
  };
}

function NumericField({ value, onChange, min, max, step = "0.001", required }: { value: number | null; onChange: (value: number | null) => void; min?: number | string; max?: number | string; step?: string; required?: boolean }) {
  const [text, setText] = useState(() => value === null ? "" : value.toFixed(3));

  return <input
    type="number" min={min} max={max} step={step} required={required}
    value={text}
    onChange={(event) => {
      const raw = event.target.value;
      setText(raw);
      if (raw === "") { onChange(null); return; }
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) onChange(parsed);
    }}
    onBlur={() => setText(value === null ? "" : value.toFixed(3))}
  />;
}

function StatusPill({ level, label }: { level: string; label: string }) {
  return <span className={`status status-${level}`}><span />{label}</span>;
}

function EventIcon({ kind }: { kind: EventKind }) {
  if (kind === "meal") return <span className="event-icon meal"><Utensils size={17} /></span>;
  if (kind === "hydration") return <span className="event-icon water"><Droplets size={17} /></span>;
  if (kind === "exercise") return <span className="event-icon exercise"><Dumbbell size={17} /></span>;
  return <span className="event-icon glucose"><Activity size={17} /></span>;
}

const EXERCISE_TYPE_LABEL: Record<ExerciseType, string> = {
  aerobic: "Aerobic exercise", resistance: "Resistance training", high_intensity: "High-intensity exercise", flexibility: "Flexibility exercise",
};

function eventTitle(event: HealthEvent): string {
  if (event.kind === "meal") return event.foodName ?? "Meal";
  if (event.kind === "hydration") return event.beverage || "Hydration";
  if (event.kind === "exercise") return EXERCISE_TYPE_LABEL[event.exerciseType ?? "aerobic"];
  return "Blood glucose";
}

function isGlucoseImpactIntake(event: HealthEvent) {
  return event.kind === "meal" || (event.kind === "hydration" && (event.carbsGrams ?? 0) > 0);
}

function LogPanel({ kind, unit, onClose, onSaved }: { kind: EventKind; unit: GlucoseUnit; onClose: () => void; onSaved: (event: HealthEvent) => void }) {
  const [entry, setEntry] = useState(emptyEvent(kind));
  const [query, setQuery] = useState("");
  const [foods, setFoods] = useState<FoodResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [foodSelectionToken, setFoodSelectionToken] = useState(0);
  const setFieldValue = (field: keyof HealthEvent, value: number | null) => setEntry((current) => ({ ...current, [field]: value }));

  async function searchFoods() {
    if (query.trim().length < 2) return;
    setSearching(true); setError("");
    try {
      setFoods(await searchFoodDatabase(query.trim()));
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Food search failed.");
    } finally { setSearching(false); }
  }

  function chooseFood(food: FoodResult) {
    if (kind === "hydration") {
      const servingUnit = food.servingUnit?.toLowerCase() ?? "";
      const selectedFluidMl = servingUnit === "ml" || servingUnit === "milliliter" || servingUnit === "milliliters"
        ? food.servingSize
        : servingUnit.includes("fl") && servingUnit.includes("oz") && food.servingSize
          ? displayToMl(food.servingSize, "mgdl")
          : entry.fluidMl;
      setEntry((current) => ({
        ...current,
        beverage: food.name,
        fluidMl: selectedFluidMl ?? current.fluidMl,
        calories: food.calories,
        carbsGrams: food.carbsGrams,
        fiberGrams: food.fiberGrams,
        proteinGrams: food.proteinGrams,
        fatGrams: food.fatGrams,
        saturatedFatGrams: food.saturatedFatGrams,
        sugarGrams: food.sugarGrams,
        sodiumMg: food.sodiumMg,
      }));
      setFoods([]); setQuery(food.name);
      setFoodSelectionToken((token) => token + 1);
      return;
    }

    const item: MealItem = {
      id: `${food.fdcId}-${foodSelectionToken}-${entry.mealItems?.length ?? 0}`,
      name: food.name,
      brand: food.brand,
      quantity: 1,
      servingLabel: food.servingSize && food.servingUnit ? `${formatNumeric(food.servingSize)} ${food.servingUnit}` : "1.000 serving",
      calories: food.calories,
      carbsGrams: food.carbsGrams,
      fiberGrams: food.fiberGrams,
      proteinGrams: food.proteinGrams,
      fatGrams: food.fatGrams,
      saturatedFatGrams: food.saturatedFatGrams,
      sugarGrams: food.sugarGrams,
      sodiumMg: food.sodiumMg,
    };
    setEntry((current) => applyMealItems(current, [...(current.mealItems ?? []), item]));
    setFoods([]); setQuery(food.name);
    setFoodSelectionToken((token) => token + 1);
  }

  function updateMealItemQuantity(id: string, quantity: number | null) {
    setEntry((current) => applyMealItems(current, (current.mealItems ?? []).map((item) => item.id === id ? { ...item, quantity: quantity ?? 0 } : item).filter((item) => item.quantity > 0)));
  }

  function removeMealItem(id: string) {
    setEntry((current) => applyMealItems(current, (current.mealItems ?? []).filter((item) => item.id !== id)));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      onSaved(await createEvent({ ...entry, recordedAt: new Date(entry.recordedAt).toISOString() })); onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save entry.");
    } finally { setSaving(false); }
  }

  const title = kind === "glucose" ? "Log blood glucose" : kind === "meal" ? "Log food" : kind === "exercise" ? "Log exercise" : "Log hydration";
  const localDate = format(parseISO(entry.recordedAt), "yyyy-MM-dd'T'HH:mm");
  const glucoseAssessment = entry.glucoseMgDl === null ? null : assessGlucose(entry.glucoseMgDl, entry.glucoseContext, unit);
  const glucoseBoundsForUnit = glucoseBounds(unit);
  const glucoseDisplayValue = entry.glucoseMgDl === null ? null : mgDlToDisplay(entry.glucoseMgDl, unit);
  const setGlucoseDisplayValue = (value: number | null) => setEntry((current) => ({ ...current, glucoseMgDl: value === null ? null : displayToMgDl(value, unit) }));
  const volumeBoundsForUnit = volumeBounds(unit);
  const fluidDisplayValue = entry.fluidMl === null ? null : mlToDisplay(entry.fluidMl, unit);
  const setFluidDisplayValue = (value: number | null) => setEntry((current) => ({ ...current, fluidMl: value === null ? null : displayToMl(value, unit) }));
  const weightBoundsForUnit = weightBounds(unit);
  const weightDisplayValue = entry.weightKg === null ? null : kgToDisplay(entry.weightKg, unit);
  const setWeightDisplayValue = (value: number | null) => setEntry((current) => ({ ...current, weightKg: value === null ? null : displayToKg(value, unit) }));
  const exercisePreview = kind === "exercise" && entry.exerciseType && entry.exerciseIntensity && entry.durationMinutes
    ? (() => {
      const energy = estimateExerciseEnergy(entry.exerciseType!, entry.exerciseIntensity!, entry.durationMinutes!, entry.weightKg);
      const impact = estimateExerciseGlucoseImpact(entry.exerciseType!, entry.durationMinutes!, energy);
      return { energy, impact };
    })()
    : null;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="log-panel" role="dialog" aria-modal="true" aria-labelledby="log-title">
      <div className="panel-heading"><div><span className="eyebrow">New health record</span><h2 id="log-title">{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
      <form onSubmit={save}>
        <label className="field"><span>Date and time</span><input type="datetime-local" value={localDate} onChange={(event) => setEntry((current) => ({ ...current, recordedAt: new Date(event.target.value).toISOString() }))} required /></label>
        {kind === "glucose" && <>
          <div className="field-row"><label className="field"><span>Blood glucose</span><div className="input-unit"><NumericField key={`glucose-${unit}`} min={glucoseBoundsForUnit.min.toFixed(3)} max={glucoseBoundsForUnit.max.toFixed(3)} value={glucoseDisplayValue} onChange={setGlucoseDisplayValue} required /><b>{glucoseUnitLabel(unit)}</b></div></label><label className="field"><span>Measurement context</span><select value={entry.glucoseContext ?? "other"} onChange={(event) => setEntry((current) => ({ ...current, glucoseContext: event.target.value as GlucoseContext }))}><option value="fasting">Fasting</option><option value="pre_meal">Before meal</option><option value="post_meal">1–2 hours after meal</option><option value="bedtime">Bedtime</option><option value="other">Other</option></select></label></div>
          {glucoseAssessment && <div className={`assessment assessment-${glucoseAssessment.level}`}><AlertTriangle size={18} /><div><strong>{glucoseAssessment.label}</strong><p>{glucoseAssessment.guidance}</p></div></div>}
        </>}
        {kind === "meal" && <>
          <label className="field"><span>Search verified foods</span><div className="search-input"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search USDA FoodData Central" /><button type="button" onClick={searchFoods} disabled={searching}>{searching ? "Searching" : "Search"}</button></div></label>
          {foods.length > 0 && <div className="food-results">{foods.map((food) => <button type="button" key={food.fdcId} onClick={() => chooseFood(food)}><span><strong>{food.name}</strong><small>{food.brand ?? "USDA reference food"}</small></span><span>{formatNumeric(food.carbsGrams)} g carbs <ChevronRight size={16} /></span></button>)}</div>}
          <label className="field"><span>Food or meal name</span><input value={entry.foodName ?? ""} onChange={(event) => setEntry((current) => ({ ...current, foodName: event.target.value }))} placeholder="e.g. Greek yogurt with berries" required /></label>
          <label className="field compact"><span>Eating duration</span><div className="input-unit"><NumericField min="1" max="240" value={entry.mealDurationMinutes} onChange={(value) => setFieldValue("mealDurationMinutes", value)} /><b>min</b></div></label>
          {(entry.mealItems ?? []).length > 0 && <div className="recipe-list"><span className="eyebrow">Meal session recipe</span>{(entry.mealItems ?? []).map((item) => <div className="recipe-item" key={item.id}><div><strong>{item.name}</strong><small>{item.servingLabel} · {formatNumeric(item.carbsGrams)} g carbs, {formatNumeric(item.fiberGrams)} g fiber per serving</small></div><div className="recipe-quantity"><NumericField min="0.001" max="100" value={item.quantity} onChange={(value) => updateMealItemQuantity(item.id, value)} /><button type="button" className="icon-button danger" onClick={() => removeMealItem(item.id)} aria-label="Remove food"><Trash2 size={15} /></button></div></div>)}</div>}
          <div className="nutrition-grid">{([['servingGrams', 'Serving', 'g'], ['calories', 'Energy', 'kcal'], ['carbsGrams', 'Carbohydrate', 'g'], ['fiberGrams', 'Fiber', 'g'], ['proteinGrams', 'Protein', 'g'], ['fatGrams', 'Total fat', 'g'], ['saturatedFatGrams', 'Saturated fat', 'g'], ['sugarGrams', 'Total sugar', 'g'], ['sodiumMg', 'Sodium', 'mg']] as const).map(([field, label, measure]) => <label className="field compact" key={field}><span>{label}</span><div className="input-unit"><NumericField key={`${field}-${foodSelectionToken}`} min="0" value={entry[field]} onChange={(value) => setFieldValue(field, value)} /><b>{measure}</b></div></label>)}</div>
          <p className="source-note"><ShieldCheck size={15} /> Values selected from search are sourced from USDA FoodData Central. Check branded-food serving units before saving.</p>
        </>}
        {kind === "hydration" && <>
          <label className="field"><span>Search verified beverages</span><div className="search-input"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search soda, juice, sports drink, milk, coffee" /><button type="button" onClick={searchFoods} disabled={searching}>{searching ? "Searching" : "Search"}</button></div></label>
          {foods.length > 0 && <div className="food-results">{foods.map((food) => <button type="button" key={food.fdcId} onClick={() => chooseFood(food)}><span><strong>{food.name}</strong><small>{food.brand ?? "USDA reference beverage"}</small></span><span>{formatNumeric(food.carbsGrams)} g carbs · {formatNumeric(food.sugarGrams)} g sugar <ChevronRight size={16} /></span></button>)}</div>}
          <div className="field-row"><label className="field"><span>Volume</span><div className="input-unit"><NumericField key={`fluid-${unit}-${foodSelectionToken}`} min={volumeBoundsForUnit.min.toFixed(3)} max={volumeBoundsForUnit.max.toFixed(3)} value={fluidDisplayValue} onChange={setFluidDisplayValue} required /><b>{volumeUnitLabel(unit)}</b></div></label><label className="field"><span>Beverage</span><input value={entry.beverage ?? ""} onChange={(event) => setEntry((current) => ({ ...current, beverage: event.target.value }))} placeholder="Water" /></label></div>
          <div className="nutrition-grid">{([['calories', 'Energy', 'kcal'], ['carbsGrams', 'Carbohydrate', 'g'], ['fiberGrams', 'Fiber', 'g'], ['proteinGrams', 'Protein', 'g'], ['fatGrams', 'Total fat', 'g'], ['saturatedFatGrams', 'Saturated fat', 'g'], ['sugarGrams', 'Total sugar', 'g'], ['sodiumMg', 'Sodium', 'mg']] as const).map(([field, label, measure]) => <label className="field compact" key={field}><span>{label}</span><div className="input-unit"><NumericField key={`hydration-${field}-${foodSelectionToken}`} min="0" value={entry[field]} onChange={(value) => setFieldValue(field, value)} /><b>{measure}</b></div></label>)}</div>
          <p className="source-note"><ShieldCheck size={15} /> Plain water stays a hydration marker. Drinks with carbohydrate or sugar are also projected as glucose-impact intake.</p>
        </>}
        {kind === "exercise" && <>
          <div className="field-row">
            <label className="field"><span>Type</span><select value={entry.exerciseType ?? "aerobic"} onChange={(event) => setEntry((current) => ({ ...current, exerciseType: event.target.value as ExerciseType }))}><option value="aerobic">Aerobic (walking, cycling, swimming)</option><option value="resistance">Resistance / strength training</option><option value="high_intensity">High-intensity / interval</option><option value="flexibility">Flexibility / low-intensity</option></select></label>
            <label className="field"><span>Intensity</span><select value={entry.exerciseIntensity ?? "moderate"} onChange={(event) => setEntry((current) => ({ ...current, exerciseIntensity: event.target.value as ExerciseIntensity }))}><option value="light">Light</option><option value="moderate">Moderate</option><option value="vigorous">Vigorous</option></select></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Duration</span><div className="input-unit"><NumericField min="1" max="600" value={entry.durationMinutes} onChange={(value) => setFieldValue("durationMinutes", value)} required /><b>min</b></div></label>
            <label className="field"><span>Body weight <small>optional</small></span><div className="input-unit"><NumericField key={`weight-${unit}`} min={weightBoundsForUnit.min.toFixed(3)} max={weightBoundsForUnit.max.toFixed(3)} value={weightDisplayValue} onChange={setWeightDisplayValue} /><b>{weightUnitLabel(unit)}</b></div></label>
          </div>
          {exercisePreview && <div className={`assessment assessment-${exercisePreview.impact.direction === "mixed" ? "watch" : exercisePreview.impact.direction === "minimal" ? "target" : "target"}`}>
            <Flame size={18} />
            <div>
              <strong>~{formatNumeric(exercisePreview.energy.caloriesBurned)} kcal burned</strong>
              <p>Estimated glucose effect: {exercisePreview.impact.direction === "lowers" ? "lowers" : exercisePreview.impact.direction === "mixed" ? "mixed (transient rise, then drop)" : "minimal"} by roughly {formatGlucose(exercisePreview.impact.lowMgDl, unit)}–{formatGlucose(exercisePreview.impact.highMgDl, unit)} {glucoseUnitLabel(unit)} over about {formatNumeric(exercisePreview.impact.windowHours)} hours. {exercisePreview.impact.explanation}</p>
            </div>
          </div>}
        </>}
        <label className="field"><span>Notes <small>optional</small></span><textarea value={entry.notes ?? ""} onChange={(event) => setEntry((current) => ({ ...current, notes: event.target.value }))} placeholder="Medication, activity, symptoms, or context" /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save record"}</button></div>
      </form>
    </section>
  </div>;
}

function HistoryPanel({ events, unit, eventDescription, onClose, onDelete }: { events: HealthEvent[]; unit: GlucoseUnit; eventDescription: (event: HealthEvent) => string; onClose: () => void; onDelete: (id: number) => void }) {
  const groups: Array<[string, HealthEvent[]]> = [];
  for (const event of events) {
    const dayKey = format(parseISO(event.recordedAt), "EEEE, MMMM d");
    const existing = groups.find(([key]) => key === dayKey);
    if (existing) existing[1].push(event);
    else groups.push([dayKey, [event]]);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="log-panel history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="panel-heading"><div><span className="eyebrow">All logged records</span><h2 id="history-title">History</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
      <p className="history-note">Records older than six months are removed automatically. Delete any entry below to correct a mistake.</p>
      <div className="history-scroll">
        {events.length === 0 && <p className="empty-state">No records yet.</p>}
        {groups.map(([day, dayEvents]) => <div className="history-day" key={day}>
          <h3>{day}</h3>
          <div className="event-list">
            {dayEvents.map((event) => {
              const assessment = event.kind === "glucose" ? assessGlucose(event.glucoseMgDl!, event.glucoseContext, unit) : isGlucoseImpactIntake(event) ? assessMeal(event) : null;
              return <article key={event.id}>
                <EventIcon kind={event.kind} />
                <div className="event-main"><strong>{eventTitle(event)}</strong><small>{eventDescription(event)}</small></div>
                {assessment && <StatusPill level={assessment.level} label={assessment.label} />}
                <time>{format(parseISO(event.recordedAt), "h:mm a")}</time>
                <button type="button" className="icon-button danger" onClick={() => onDelete(event.id)} aria-label="Delete record"><Trash2 size={15} /></button>
              </article>;
            })}
          </div>
        </div>)}
      </div>
    </section>
  </div>;
}

export default function Dashboard() {
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [logKind, setLogKind] = useState<EventKind | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [unit, setUnit] = useState<GlucoseUnit>("mgdl");
  const [name, setName] = useState("");
  const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([]);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const displayName = name.trim();
  const initials = displayName ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("") : "";
  const backupDue = events.length > 0 && (!lastBackupAt || new Date().getTime() - new Date(lastBackupAt).getTime() > BACKUP_REMINDER_DAYS * 86400000);

  const refreshRestorePoints = () => listRestorePoints().then(setRestorePoints).catch(() => undefined);

  useEffect(() => {
    let cancelled = false;
    listEvents()
      .then((stored) => { if (!cancelled) setEvents(stored); })
      .catch(() => { if (!cancelled) setStorageError("MediTrack could not open its on-device database. Private browsing mode blocks local storage; open the app from your Home Screen instead."); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    takeSnapshot(12 * 3600000).then(() => { if (!cancelled) return refreshRestorePoints(); }).catch(() => undefined);
    requestPersistentStorage().catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function removeEvent(id: number) {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    try {
      await deleteEvent(id);
      setEvents((current) => current.filter((event) => event.id !== id));
      void refreshRestorePoints();
    } catch {
      setBackupMessage("Unable to delete that record.");
    }
  }

  async function downloadBackup() {
    try {
      // Dated, never overwritten: Files lists the newest first.
      const file = new File([await exportBackup()], `MediTrack-backup-${format(new Date(), "yyyy-MM-dd_HH-mm")}.json`, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "MediTrack backup" });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url; link.download = file.name; link.click();
        URL.revokeObjectURL(url);
      }
      const savedAt = new Date().toISOString();
      localStorage.setItem(LAST_BACKUP_STORAGE_KEY, savedAt);
      setLastBackupAt(savedAt);
      setBackupMessage("Backup created. Choose Save to Files → iCloud Drive → MediTrack so it survives if this app is ever deleted.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setBackupMessage("Unable to create a backup.");
    }
  }

  async function restoreFromRestorePoint(id: number) {
    try {
      const added = await restoreFromPoint(id);
      setEvents(await listEvents());
      setBackupMessage(added === 0 ? "Nothing to restore: every record in that restore point is already here." : `Restored ${added} missing record${added === 1 ? "" : "s"}.`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Unable to restore.");
    }
  }

  async function restoreBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const added = await importBackup(await file.text());
      setEvents(await listEvents());
      setBackupMessage(`Restored ${added} record${added === 1 ? "" : "s"}.`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Unable to restore that file.");
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem(GLUCOSE_UNIT_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores a persisted client-only preference after the server-rendered default mounts
    if (isGlucoseUnit(stored)) setUnit(stored);
    setName(localStorage.getItem(PROFILE_NAME_STORAGE_KEY) ?? "");
    setLastBackupAt(localStorage.getItem(LAST_BACKUP_STORAGE_KEY));
  }, []);

  function updateName(value: string) {
    const next = value.slice(0, 40);
    setName(next);
    localStorage.setItem(PROFILE_NAME_STORAGE_KEY, next);
  }

  function selectUnit(nextUnit: GlucoseUnit) {
    setUnit(nextUnit);
    localStorage.setItem(GLUCOSE_UNIT_STORAGE_KEY, nextUnit);
  }

  const glucoseEvents = events.filter((event) => event.kind === "glucose" && event.glucoseMgDl !== null);
  const glucoseImpactIntakeEvents = events.filter(isGlucoseImpactIntake);
  const todayEvents = events.filter((event) => isToday(parseISO(event.recordedAt)));
  const todayMeals = glucoseImpactIntakeEvents.filter((event) => isToday(parseISO(event.recordedAt)));
  const todayHydration = todayEvents.filter((event) => event.kind === "hydration").reduce((sum, event) => sum + (event.fluidMl ?? 0), 0);
  const todayCarbs = todayMeals.reduce((sum, event) => sum + (event.carbsGrams ?? 0), 0);
  const averageGlucose = glucoseEvents.length ? glucoseEvents.reduce((sum, event) => sum + (event.glucoseMgDl ?? 0), 0) / glucoseEvents.length : 0;
  const latestGlucose = glucoseEvents[0];
  const latestAssessment = latestGlucose ? assessGlucose(latestGlucose.glucoseMgDl!, latestGlucose.glucoseContext, unit) : null;
  const chartBounds = { low: mgDlToDisplay(70, unit), high: mgDlToDisplay(180, unit) };

  const activeMealWindowMinutes = 210;
  const nowMs = new Date().getTime();
  const candidateMeal = [...glucoseImpactIntakeEvents]
    .map((event) => ({ event, mealTimeMs: parseISO(event.recordedAt).getTime() }))
    .filter(({ mealTimeMs }) => { const minutesAgo = (nowMs - mealTimeMs) / 60000; return minutesAgo >= 0 && minutesAgo <= activeMealWindowMinutes; })
    .sort((a, b) => b.mealTimeMs - a.mealTimeMs)[0];
  const baselineGlucoseEvent = candidateMeal
    ? glucoseEvents.find((event) => parseISO(event.recordedAt).getTime() <= candidateMeal.mealTimeMs) ?? glucoseEvents[glucoseEvents.length - 1]
    : undefined;
  const mealImpact = candidateMeal ? estimateMealGlucoseImpact(candidateMeal.event) : null;
  const trajectory = mealImpact && baselineGlucoseEvent ? projectPostMealTrajectory(baselineGlucoseEvent.glucoseMgDl!, mealImpact) : [];
  const forecast = trajectory.length ? forecastGlucoseRisk(trajectory, todayHydration) : null;
  const mealAbsorptionAnchorMs = candidateMeal ? candidateMeal.mealTimeMs + ((candidateMeal.event.kind === "hydration" ? 5 : candidateMeal.event.mealDurationMinutes ?? 20) / 2) * 60000 : null;

  const exerciseEvents = events.filter((event) => event.kind === "exercise" && event.exerciseType && event.exerciseIntensity && event.durationMinutes);
  const todayExerciseMinutes = exerciseEvents.filter((event) => isToday(parseISO(event.recordedAt))).reduce((sum, event) => sum + (event.durationMinutes ?? 0), 0);
  const candidateExercise = exerciseEvents
    .map((event) => ({ event, startMs: parseISO(event.recordedAt).getTime() }))
    .filter(({ startMs }) => { const hoursAgo = (nowMs - startMs) / 3600000; return hoursAgo >= 0 && hoursAgo <= 24; })
    .sort((a, b) => b.startMs - a.startMs)[0];
  const exerciseEnergy = candidateExercise ? estimateExerciseEnergy(candidateExercise.event.exerciseType!, candidateExercise.event.exerciseIntensity!, candidateExercise.event.durationMinutes!, candidateExercise.event.weightKg) : null;
  const exerciseImpact = candidateExercise && exerciseEnergy ? estimateExerciseGlucoseImpact(candidateExercise.event.exerciseType!, candidateExercise.event.durationMinutes!, exerciseEnergy) : null;
  const preExerciseGlucose = candidateExercise ? glucoseEvents.find((event) => parseISO(event.recordedAt).getTime() <= candidateExercise.startMs) : undefined;
  const preExerciseNote = preExerciseGlucose ? preExerciseGuidance(preExerciseGlucose.glucoseMgDl!) : null;
  const hypoCaution = candidateExercise ? exerciseHypoglycemiaCaution(candidateExercise.event.exerciseType!, candidateExercise.event.durationMinutes!) : null;

  const actualPoints: ChartPoint[] = [...glucoseEvents].reverse().filter((event) => parseISO(event.recordedAt) > subDays(new Date(), 14)).map((event) => {
    const timestamp = parseISO(event.recordedAt).getTime();
    return { timestamp, time: format(new Date(timestamp), "MMM d, h a"), value: mgDlToDisplay(event.glucoseMgDl!, unit) };
  });
  const projectedPoints: ChartPoint[] = candidateMeal ? trajectory.map((point) => {
    const timestamp = (mealAbsorptionAnchorMs ?? candidateMeal.mealTimeMs) + point.minutesFromAnchor * 60000;
    return {
      timestamp, time: format(new Date(timestamp), "MMM d, h:mm a"),
      projLow: mgDlToDisplay(point.low, unit), projHigh: mgDlToDisplay(point.high, unit), projExpected: mgDlToDisplay(point.expected, unit),
    };
  }) : [];
  const exerciseProjectedPoints: ChartPoint[] = candidateExercise && exerciseImpact && preExerciseGlucose ? [0, 0.5, 1, 2, 4, exerciseImpact.windowHours]
    .filter((hour, index, hours) => hour <= exerciseImpact.windowHours && hours.indexOf(hour) === index)
    .map((hour) => {
      const timestamp = candidateExercise.startMs + hour * 3600000;
      const point = exerciseProjectionAt(preExerciseGlucose.glucoseMgDl!, exerciseImpact.direction, exerciseImpact.lowMgDl, exerciseImpact.highMgDl, hour, exerciseImpact.windowHours);
      return {
        timestamp, time: format(new Date(timestamp), "MMM d, h:mm a"),
        exerciseLow: mgDlToDisplay(point.low, unit), exerciseHigh: mgDlToDisplay(point.high, unit), exerciseExpected: mgDlToDisplay(point.expected, unit),
      };
    }) : [];
  const netAnchorMs = Math.min(...[mealAbsorptionAnchorMs, candidateExercise?.startMs].filter((value): value is number => value !== null && value !== undefined));
  const netBaseline = Number.isFinite(netAnchorMs) ? glucoseEvents.find((event) => parseISO(event.recordedAt).getTime() <= netAnchorMs)?.glucoseMgDl ?? latestGlucose?.glucoseMgDl : undefined;
  const netEndMs = Math.max(...[
    mealAbsorptionAnchorMs && mealImpact ? mealAbsorptionAnchorMs + mealImpact.returnMinutes * 60000 : undefined,
    candidateExercise && exerciseImpact ? candidateExercise.startMs + exerciseImpact.windowHours * 3600000 : undefined,
  ].filter((value): value is number => value !== undefined && value !== null));
  const hasNetBaseline = typeof netBaseline === "number";
  const netProjectedPoints: ChartPoint[] = hasNetBaseline && Number.isFinite(netAnchorMs) && Number.isFinite(netEndMs)
    ? Array.from({ length: Math.floor((netEndMs - netAnchorMs) / 1800000) + 1 }, (_, index) => netAnchorMs + index * 1800000).map((timestamp) => {
      const mealDelta = mealImpact && mealAbsorptionAnchorMs
        ? mealProjectionAt(netBaseline, mealImpact.lowRiseMgDl, mealImpact.highRiseMgDl, (timestamp - mealAbsorptionAnchorMs) / 60000, mealImpact.peakMinutes, mealImpact.returnMinutes).expected - netBaseline
        : 0;
      const exerciseDelta = exerciseImpact && candidateExercise
        ? exerciseProjectionAt(netBaseline, exerciseImpact.direction, exerciseImpact.lowMgDl, exerciseImpact.highMgDl, (timestamp - candidateExercise.startMs) / 3600000, exerciseImpact.windowHours).expected - netBaseline
        : 0;
      return { timestamp, time: format(new Date(timestamp), "MMM d, h:mm a"), netExpected: mgDlToDisplay(Math.max(0, netBaseline + mealDelta + exerciseDelta), unit) };
    })
    : [];
  const hydrationPoints: ChartPoint[] = events
    .filter((event) => event.kind === "hydration" && event.fluidMl !== null && parseISO(event.recordedAt) > subDays(new Date(), 14))
    .map((event) => {
      const timestamp = parseISO(event.recordedAt).getTime();
      return { timestamp, time: format(new Date(timestamp), "MMM d, h:mm a"), hydrationMarker: chartBounds.low, hydrationMl: event.fluidMl ?? 0 };
    });
  const chartData: ChartPoint[] = [...actualPoints, ...projectedPoints, ...exerciseProjectedPoints, ...netProjectedPoints, ...hydrationPoints]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((point) => ({
      ...point,
      projBand: point.projHigh !== undefined && point.projLow !== undefined ? point.projHigh - point.projLow : undefined,
      exerciseBand: point.exerciseHigh !== undefined && point.exerciseLow !== undefined ? point.exerciseHigh - point.exerciseLow : undefined,
    }));
  // Derive the axis range from what's actually plotted (plus the target band) so no reading — including lows — is ever clipped.
  const domainCandidates = [...chartData.flatMap((point) => [point.value, point.projLow, point.projHigh, point.exerciseLow, point.exerciseHigh, point.netExpected, point.hydrationMarker]), chartBounds.low, chartBounds.high]
    .filter((value): value is number => value !== undefined);
  const rawDomainMin = domainCandidates.length ? Math.min(...domainCandidates) : mgDlToDisplay(50, unit);
  const rawDomainMax = domainCandidates.length ? Math.max(...domainCandidates) : mgDlToDisplay(250, unit);
  const domainPadding = Math.max((rawDomainMax - rawDomainMin) * 0.15, mgDlToDisplay(10, unit) - mgDlToDisplay(0, unit));
  const domainMin = Math.max(0, rawDomainMin - domainPadding);
  const domainMax = rawDomainMax + domainPadding;

  const eventDescription = (event: HealthEvent) => event.kind === "glucose"
    ? `${formatGlucose(event.glucoseMgDl, unit)} ${glucoseUnitLabel(unit)} · ${(event.glucoseContext ?? "other").replace("_", " ")}`
    : event.kind === "hydration"
      ? `${formatNumeric(mlToDisplay(event.fluidMl ?? 0, unit))} ${volumeUnitLabel(unit)} · ${event.beverage || "Water"}${(event.carbsGrams ?? 0) > 0 ? ` · ${formatNumeric(event.carbsGrams ?? 0)} g carbs · ${formatNumeric(event.sugarGrams ?? 0)} g sugar` : ""}`
      : event.kind === "exercise"
        ? (() => { const energy = estimateExerciseEnergy(event.exerciseType ?? "aerobic", event.exerciseIntensity ?? "moderate", event.durationMinutes ?? 0, event.weightKg); return `${formatNumeric(event.durationMinutes ?? 0)} min · ${event.exerciseIntensity ?? "moderate"} · ~${formatNumeric(energy.caloriesBurned)} kcal`; })()
        : (() => { const impact = estimateMealGlucoseImpact(event); return `${formatNumeric(event.carbsGrams ?? 0)} g carbs · ${formatNumeric(event.fiberGrams ?? 0)} g fiber · est. +${formatGlucose(impact.lowRiseMgDl, unit)}–${formatGlucose(impact.highRiseMgDl, unit)} ${glucoseUnitLabel(unit)}`; })();

  function renderGlucoseTooltip({ active, label, payload }: { active?: boolean; label?: string | number; payload?: ReadonlyArray<{ payload?: ChartPoint }> }) {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0].payload;
    if (!point) return null;
    return <div className="chart-tooltip">
      <strong>{label}</strong>
      {point.value !== undefined && <p>Measured: {formatNumeric(point.value)} {glucoseUnitLabel(unit)}</p>}
      {point.projExpected !== undefined && <p>Estimated: {formatNumeric(point.projExpected)} {glucoseUnitLabel(unit)} (range {formatNumeric(point.projLow ?? 0)}–{formatNumeric(point.projHigh ?? 0)})</p>}
      {point.exerciseExpected !== undefined && <p>Exercise effect: {formatNumeric(point.exerciseExpected)} {glucoseUnitLabel(unit)} (range {formatNumeric(point.exerciseLow ?? 0)}–{formatNumeric(point.exerciseHigh ?? 0)})</p>}
      {point.netExpected !== undefined && <p>Combined estimate: {formatNumeric(point.netExpected)} {glucoseUnitLabel(unit)} after food and exercise timing interact.</p>}
      {point.hydrationMl !== undefined && <p>Hydration: {formatNumeric(mlToDisplay(point.hydrationMl, unit))} {volumeUnitLabel(unit)} logged. Low hydration can concentrate glucose but is not modeled as a precise curve.</p>}
    </div>;
  }

  if (!loaded) return <div className="app-loading" role="status">Opening your private health record…</div>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span><HeartPulse size={22} /></span><strong>MediTrack</strong></div><nav aria-label="Primary"><a className="active" href="#overview"><LayoutDashboard size={19} />Overview</a><a href="#glucose"><Activity size={19} />Glucose</a><a href="#nutrition"><Apple size={19} />Nutrition</a><a href="#hydration"><Droplets size={19} />Hydration</a><a href="#exercise"><Dumbbell size={19} />Exercise</a><a href="#" onClick={(event) => { event.preventDefault(); setShowHistory(true); }}><HistoryIcon size={19} />History</a></nav><div className="unit-toggle" role="group" aria-label="Glucose units"><button type="button" className={unit === "mgdl" ? "active" : ""} onClick={() => selectUnit("mgdl")}>mg/dL (US)</button><button type="button" className={unit === "mmoll" ? "active" : ""} onClick={() => selectUnit("mmoll")}>mmol/L (UK)</button></div><div className="sidebar-note"><ShieldCheck size={20} /><div><strong>Private by design</strong><p>Records stay in your local database.</p></div></div>{displayName && <div className="profile"><span>{initials}</span><div><strong>{displayName}</strong><small>Patient profile</small></div></div>}</aside>
    <main className="main-content" id="overview">
      <header className="topbar"><div><p>{format(new Date(), "EEEE, MMMM d")}{displayName && ` · Hi, ${displayName}`}</p><h1>Today’s health picture</h1></div><button className="button primary" onClick={() => setLogKind("glucose")}><Plus size={18} />Add reading</button></header>
      {backupDue && <section className="backup-reminder"><Download size={18} /><p>Your records are only on this phone. <a href="#backup">Save a backup to Files</a> so they&apos;re safe if the app is ever deleted.</p></section>}
      {storageError && <section className="urgent-banner"><AlertTriangle size={22} /><div><strong>Storage unavailable</strong><p>{storageError}</p></div></section>}
      {latestAssessment?.level === "urgent" && <section className="urgent-banner"><AlertTriangle size={22} /><div><strong>{latestAssessment.label}: {formatGlucose(latestGlucose.glucoseMgDl, unit)} {glucoseUnitLabel(unit)}</strong><p>{latestAssessment.guidance}</p></div></section>}
      <section className="metric-grid" aria-label="Daily health summary">
        <article className="metric featured"><div className="metric-heading"><span>Latest glucose</span><Activity size={19} /></div><div className="metric-value">{formatGlucose(latestGlucose?.glucoseMgDl, unit)}<small>{glucoseUnitLabel(unit)}</small></div>{latestAssessment && <StatusPill level={latestAssessment.level} label={latestAssessment.label} />}<p>{latestGlucose ? format(parseISO(latestGlucose.recordedAt), "h:mm a · MMM d") : "No readings yet"}</p></article>
        <article className="metric"><div className="metric-heading"><span>Average glucose</span><HeartPulse size={19} /></div><div className="metric-value">{formatGlucose(averageGlucose || null, unit)}<small>{glucoseUnitLabel(unit)}</small></div><p>{formatNumeric(glucoseEvents.length)} logged readings</p></article>
        <article className="metric"><div className="metric-heading"><span>Estimated A1C</span><ShieldCheck size={19} /></div><div className="metric-value">{formatNumeric(averageGlucose ? estimatedA1c(averageGlucose) : null)}<small>%</small></div><p>Estimate from available mean glucose</p></article>
        <article className="metric" id="hydration"><div className="metric-heading"><span>Hydration today</span><Droplets size={19} /></div><div className="metric-value">{unit === "mgdl" ? formatNumeric(mlToDisplay(todayHydration, unit)) : formatNumeric(todayHydration / 1000)}<small>{unit === "mgdl" ? "fl oz" : "L"}</small></div><div className="progress"><span style={{ width: `${Math.min(100, todayHydration / 20)}%` }} /></div><p>Personal needs vary with health and activity</p></article>
      </section>
      <div className="content-grid"><section className="chart-section" id="glucose"><div className="section-heading"><div><span className="eyebrow">Last 14 days</span><h2>Glucose trend</h2></div><div className="legend"><span className="target-dot" />Common target band{trajectory.length > 0 && <span className="legend-item"><span className="proj-dot" />Estimated post-meal range</span>}{exerciseProjectedPoints.length > 0 && <span className="legend-item"><span className="exercise-dot" />Estimated exercise effect</span>}{netProjectedPoints.length > 0 && <span className="legend-item"><span className="target-dot" style={{ borderTopStyle: "solid", borderTopColor: "var(--red)", borderTopWidth: 3 }} />Combined estimate</span>}{hydrationPoints.length > 0 && <span className="legend-item"><span className="hydration-dot" />Hydration logged</span>}</div></div><div className="chart-wrap">{chartData.length > 0 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 14, right: 16, left: 4, bottom: 0 }}><defs><linearGradient id="glucoseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#18786e" stopOpacity={0.25} /><stop offset="95%" stopColor="#18786e" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#e9ece8" vertical={false} /><XAxis dataKey="time" tick={{ fontSize: 11, fill: "#75807a" }} tickLine={false} axisLine={false} minTickGap={45} /><YAxis domain={[domainMin, domainMax]} allowDataOverflow width={60} tickCount={5} tickFormatter={(value) => formatNumeric(value)} tick={{ fontSize: 11, fill: "#75807a" }} tickLine={false} axisLine={false} /><Tooltip content={renderGlucoseTooltip} /><ReferenceLine y={chartBounds.high} stroke="#d39a37" strokeDasharray="4 4" /><ReferenceLine y={chartBounds.low} stroke="#d39a37" strokeDasharray="4 4" /><Area dataKey="projLow" stackId="proj" stroke="none" fill="transparent" isAnimationActive={false} /><Area dataKey="projBand" stackId="proj" stroke="none" fill="#d39a37" fillOpacity={0.16} isAnimationActive={false} /><Area dataKey="exerciseLow" stackId="exercise" stroke="none" fill="transparent" isAnimationActive={false} /><Area dataKey="exerciseBand" stackId="exercise" stroke="none" fill="#6a3fb5" fillOpacity={0.12} isAnimationActive={false} /><Line dataKey="projExpected" stroke="#d39a37" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} /><Line dataKey="exerciseExpected" stroke="#6a3fb5" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls isAnimationActive={false} /><Line dataKey="netExpected" stroke="#b53a34" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} /><Scatter dataKey="hydrationMarker" fill="#347a96" shape="circle" isAnimationActive={false} /><Area type="monotone" dataKey="value" stroke="#18786e" strokeWidth={3} fill="url(#glucoseFill)" dot={{ fill: "#fff", stroke: "#18786e", strokeWidth: 2, r: 4 }} connectNulls /></ComposedChart></ResponsiveContainer> : <div className="empty-state">Log a glucose reading to begin your trend.</div>}</div><div className="chart-footnote"><ShieldCheck size={15} /> Common ADA goals for most nonpregnant adults: {mgDlToDisplay(80, unit).toFixed(3)}–{mgDlToDisplay(130, unit).toFixed(3)} {glucoseUnitLabel(unit)} before meals and below {mgDlToDisplay(180, unit).toFixed(3)} {glucoseUnitLabel(unit)} 1.000–2.000 hours after starting a meal. The combined line shows how meal timing and exercise timing may offset or compound each other; hydration markers show intake timing because hydration modifies risk but does not have a validated precise glucose curve. Your clinician may set different goals.</div></section>
        <aside className="quick-log"><div className="section-heading"><div><span className="eyebrow">Keep the picture current</span><h2>Quick log</h2></div></div>{([['glucose', Activity, 'Blood glucose', 'Meter or CGM reading'], ['meal', Utensils, 'Food & nutrition', `${formatNumeric(todayCarbs)} g carbs today`], ['hydration', Droplets, 'Hydration', `${formatNumeric(mlToDisplay(todayHydration, unit))} ${volumeUnitLabel(unit)} today`], ['exercise', Dumbbell, 'Exercise', `${formatNumeric(todayExerciseMinutes)} min today`]] as const).map(([kind, Icon, title, detail]) => <button key={kind} onClick={() => setLogKind(kind)}><span className={`event-icon ${kind === 'hydration' ? 'water' : kind}`}><Icon size={18} /></span><span><strong>{title}</strong><small>{detail}</small></span><Plus size={18} /></button>)}</aside></div>
      <section className="predicted-section" id="predicted">
        <div className="section-heading"><div><span className="eyebrow">Nutrition-linked estimate</span><h2>Predicted glucose impact</h2></div></div>
        {candidateMeal && mealImpact && baselineGlucoseEvent && forecast ? <div className={`predicted-card risk-${forecast.level}`}>
          <div className="predicted-summary"><p><strong>{eventTitle(candidateMeal.event)}</strong> logged {format(new Date(candidateMeal.mealTimeMs), "h:mm a")} contributes an estimated <strong>{formatGlucose(mealImpact.lowRiseMgDl, unit)}–{formatGlucose(mealImpact.highRiseMgDl, unit)} {glucoseUnitLabel(unit)}</strong> rise from {formatNumeric(mealImpact.availableCarbs)} g of available carbohydrate (total carbohydrate minus fiber), moderated by its protein and fat content. Peak impact is estimated around {formatNumeric(mealImpact.peakMinutes / 60)} hours after intake, returning toward baseline by about {formatNumeric(mealImpact.returnMinutes / 60)} hours.</p></div>
          <div className="predicted-forecast"><AlertTriangle size={18} /><div><strong>{forecast.level === "elevated" ? "Elevated risk" : forecast.level === "watch" ? "Watch closely" : "Within typical range"}</strong><p>{forecast.message}</p></div></div>
          <p className="predicted-caveat"><ShieldCheck size={14} /> Estimate only — based on carbohydrate-counting and glycemic-response science (fiber subtraction, protein/fat moderation, typical postprandial timing). Not a measurement, insulin dose, or diagnosis. Confirm with an actual glucose check.</p>
        </div> : <div className="predicted-card empty"><p>Log a meal alongside a recent glucose reading to see its estimated glucose impact and a short-term projection here.</p></div>}
      </section>
      <section className="exercise-section" id="exercise">
        <div className="section-heading"><div><span className="eyebrow">Movement-linked estimate</span><h2>Exercise & glucose connection</h2></div></div>
        {candidateExercise && exerciseEnergy && exerciseImpact ? <div className={`predicted-card risk-${exerciseImpact.direction === "mixed" ? "watch" : "none"}`}>
          <div className="predicted-summary"><p>{eventTitle(candidateExercise.event)} for {formatNumeric(candidateExercise.event.durationMinutes)} minutes at {candidateExercise.event.exerciseIntensity} intensity, logged {format(new Date(candidateExercise.startMs), "h:mm a")}, burns an estimated <strong>{formatNumeric(exerciseEnergy.caloriesBurned)} kcal</strong>. Estimated glucose effect: {exerciseImpact.direction === "lowers" ? "a decrease" : exerciseImpact.direction === "mixed" ? "a brief rise, then a decrease" : "minimal change"} of roughly <strong>{formatGlucose(exerciseImpact.lowMgDl, unit)}–{formatGlucose(exerciseImpact.highMgDl, unit)} {glucoseUnitLabel(unit)}</strong> over about {formatNumeric(exerciseImpact.windowHours)} hours. {exerciseImpact.explanation}</p></div>
          {preExerciseNote && <div className="predicted-forecast"><Flame size={18} /><div><strong>Pre-exercise glucose check</strong><p>{preExerciseNote.message}</p></div></div>}
          {hypoCaution && <div className="predicted-forecast"><AlertTriangle size={18} /><div><strong>Delayed hypoglycemia risk</strong><p>{hypoCaution}</p></div></div>}
          <p className="predicted-caveat"><ShieldCheck size={14} /> Estimate only — based on exercise physiology (contraction-mediated muscle glucose uptake, catecholamine effects during high-intensity effort, and insulin-sensitizing after-effects). Not personalized insulin or medication guidance. Confirm with an actual glucose check.</p>
        </div> : <div className="predicted-card empty"><p>Log a workout to see its estimated calorie burn and glucose connection here.</p></div>}
      </section>
      <section className="recent-section" id="nutrition"><div className="section-heading"><div><span className="eyebrow">Context builds insight</span><h2>Recent records</h2></div><div className="section-actions"><span className="record-count">{formatNumeric(events.length)} records</span><button type="button" className="button secondary small" onClick={() => setShowHistory(true)}><HistoryIcon size={15} />View all</button></div></div><div className="event-list">{events.slice(0, 8).map((event) => { const assessment = event.kind === "glucose" ? assessGlucose(event.glucoseMgDl!, event.glucoseContext, unit) : isGlucoseImpactIntake(event) ? assessMeal(event) : null; return <article key={event.id}><EventIcon kind={event.kind} /><div className="event-main"><strong>{eventTitle(event)}</strong><small>{eventDescription(event)}</small></div>{assessment && <StatusPill level={assessment.level} label={assessment.label} />}<time>{format(parseISO(event.recordedAt), isToday(parseISO(event.recordedAt)) ? "h:mm a" : "MMM d, h:mm a")}</time><button type="button" className="icon-button danger" onClick={() => removeEvent(event.id)} aria-label="Delete record"><Trash2 size={15} /></button></article>; })}</div></section>
      <section className="backup-section" id="backup"><div><h2>Your data stays on this phone</h2><p>Records are stored only in this device&apos;s local database and are never uploaded. Restore points are made automatically, but they live on this phone too, so deleting the app or clearing Safari data erases them. Save a backup to Files regularly.</p><p className={backupDue ? "backup-warning" : "backup-status"}>{lastBackupAt ? `Last saved to Files: ${format(parseISO(lastBackupAt), "MMM d, yyyy h:mm a")}` : "Not yet saved to Files."}{backupDue && ` It has been more than ${BACKUP_REMINDER_DAYS} days or no backup exists — tap “Save backup to Files”.`}</p>{backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}{restorePoints.length > 0 && <details className="restore-points"><summary>Automatic restore points ({restorePoints.length})</summary><ul>{restorePoints.map((point) => <li key={point.id}><span>{format(parseISO(point.createdAt), "MMM d, yyyy h:mm a")} · {point.count} records</span><button type="button" className="button secondary small" onClick={() => restoreFromRestorePoint(point.id)}>Restore</button></li>)}</ul></details>}<label className="name-field">Your name (optional, stays on this phone)<input type="text" value={name} maxLength={40} autoComplete="given-name" onChange={(event) => updateName(event.target.value)} /></label></div><div className="backup-actions"><button type="button" className="button secondary small" onClick={downloadBackup}><Download size={15} />Save backup to Files</button><label className="button secondary small"><Upload size={15} />Restore from file<input type="file" accept="application/json,.json" onChange={restoreBackup} hidden /></label></div></section>
      <footer><p>MediTrack supports informed conversations with your care team. It does not diagnose, prescribe insulin, or replace emergency care.</p><p>Nutrition source: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central.</p></footer>
    </main>
    {logKind && <LogPanel kind={logKind} unit={unit} onClose={() => setLogKind(null)} onSaved={(event) => { setEvents((current) => [event, ...current]); window.setTimeout(() => void refreshRestorePoints(), 800); }} />}
    {showHistory && <HistoryPanel events={events} unit={unit} eventDescription={eventDescription} onClose={() => setShowHistory(false)} onDelete={removeEvent} />}
  </div>;
}