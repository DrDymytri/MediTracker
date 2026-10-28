import { eventSchema, type EventInput } from "./validation";
import type { HealthEvent } from "./types";

// All records live in this browser-managed IndexedDB database on the device itself.
const DB_NAME = "meditrack";
const STORE = "health_events";
const RETENTION_MONTHS = 6;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("recordedAt", "recordedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the local database."));
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Local database error.")); };
  });
}

// Retention policy: records older than six months are removed automatically on every read.
async function pruneOldEvents() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  await run("readwrite", (store) => { store.index("recordedAt").openKeyCursor(IDBKeyRange.upperBound(cutoff.toISOString(), true)).onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
    if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
  }; });
}

export async function listEvents(): Promise<HealthEvent[]> {
  await pruneOldEvents();
  const all = (await run("readonly", (store) => store.getAll())) as HealthEvent[] | undefined;
  return (all ?? []).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export async function createEvent(input: unknown): Promise<HealthEvent> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid entry.");
  const data: EventInput = parsed.data;
  const id = await run("readwrite", (store) => store.add(data)) as IDBValidKey;
  return { ...data, id: Number(id) };
}

export async function deleteEvent(id: number): Promise<void> {
  await run("readwrite", (store) => { store.delete(id); });
}

export async function exportBackup(): Promise<string> {
  const events = await listEvents();
  return JSON.stringify({ app: "MediTrack", version: 1, exportedAt: new Date().toISOString(), events }, null, 2);
}

export async function importBackup(json: string): Promise<number> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("That file is not a valid MediTrack backup."); }
  const events = (parsed as { app?: string; events?: unknown[] })?.events;
  if (!Array.isArray(events)) throw new Error("That file is not a valid MediTrack backup.");
  const valid = events.map((item) => {
    const rest = { ...((item ?? {}) as Record<string, unknown>) };
    delete rest.id;
    const result = eventSchema.safeParse(rest);
    if (!result.success) throw new Error("The backup contains an invalid record, so nothing was imported.");
    return result.data;
  });
  const existing = await listEvents();
  const seen = new Set(existing.map((event) => `${event.kind}|${event.recordedAt}|${event.glucoseMgDl}|${event.foodName}|${event.fluidMl}|${event.durationMinutes}`));
  const fresh = valid.filter((event) => !seen.has(`${event.kind}|${event.recordedAt}|${event.glucoseMgDl}|${event.foodName}|${event.fluidMl}|${event.durationMinutes}`));
  await run("readwrite", (store) => { fresh.forEach((event) => store.add(event)); });
  return fresh.length;
}

// Asks iOS/Safari not to evict this site's data when storage is low.
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}
