"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  ABILITY_SHORT_LABELS,
  ARMOR_TRAINING_FIELDS,
  SPELL_SLOT_LEVELS,
  SKILL_ROWS,
  createDefaultCharacterSheet,
  createSpellRow,
  createWeaponRow,
  normalizeCharacterSheet,
  type AbilityKey,
  type CharacterSheetData,
} from "@/lib/character-sheet";

type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type CharacterSheetEditorProps = {
  roomId: string;
  participantId: string;
  participantName: string;
};

const SECTION_IDS = [
  "identity",
  "combat",
  "abilities",
  "skills",
  "features",
  "narrative",
  "weapons",
  "spellcasting",
] as const;
type SectionId = (typeof SECTION_IDS)[number];
const DEFAULT_SECTION_ORDER: readonly SectionId[] = SECTION_IDS;
const SECTION_ORDER_STORAGE_KEY = "frp:character-sheet:section-order";

type SectionMeta = {
  title: string;
  description: string;
  className?: string;
};

const SECTION_META: Record<SectionId, SectionMeta> = {
  identity: {
    title: "Identity & progression",
    description: "Core character identity from the first page.",
  },
  combat: {
    title: "Combat & survival",
    description: "HP, AC, initiative, hit dice and death saves.",
  },
  abilities: {
    title: "Abilities",
    description: "Scores, modifiers and saving throws for each ability.",
    className: "xl:col-span-2",
  },
  skills: {
    title: "Skills",
    description: "Skill modifiers. Each skill's governing ability is shown in parentheses.",
    className: "xl:col-span-2",
  },
  features: {
    title: "Features & proficiencies",
    description: "Traits, feats, class features, languages and training.",
  },
  narrative: {
    title: "Narrative & equipment",
    description: "Appearance, backstory, coins and carried gear.",
  },
  weapons: {
    title: "Weapons & cantrips",
    description: "Attack bonus/DC, damage and notes.",
  },
  spellcasting: {
    title: "Spellcasting",
    description: "Spellcasting stats, slots and prepared spells.",
    className: "xl:col-span-2",
  },
};

function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && (SECTION_IDS as readonly string[]).includes(value);
}

function loadStoredSectionOrder(): SectionId[] {
  if (typeof window === "undefined") return [...DEFAULT_SECTION_ORDER];
  try {
    const raw = window.localStorage.getItem(SECTION_ORDER_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SECTION_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_SECTION_ORDER];
    const stored = parsed.filter(isSectionId);
    const missing = DEFAULT_SECTION_ORDER.filter((id) => !stored.includes(id));
    return [...stored, ...missing];
  } catch {
    return [...DEFAULT_SECTION_ORDER];
  }
}

function persistSectionOrder(order: SectionId[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SECTION_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage errors (e.g. quota, privacy mode).
  }
}

function clearStoredSectionOrder() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SECTION_ORDER_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

const DEATH_SAVE_MAX = 3;

function deathSaveStorageKey(roomId: string, participantId: string) {
  return `frp:character-sheet:death-saves:${roomId}:${participantId}`;
}

function clampDeathSave(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(DEATH_SAVE_MAX, Math.max(0, Math.trunc(parsed)));
}

type DeathSaveStored = { successes: number; failures: number };

function loadStoredDeathSaves(
  roomId: string,
  participantId: string
): DeathSaveStored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(deathSaveStorageKey(roomId, participantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      successes: clampDeathSave((parsed as { successes?: unknown }).successes),
      failures: clampDeathSave((parsed as { failures?: unknown }).failures),
    };
  } catch {
    return null;
  }
}

function persistDeathSaves(
  roomId: string,
  participantId: string,
  values: DeathSaveStored
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      deathSaveStorageKey(roomId, participantId),
      JSON.stringify(values)
    );
  } catch {
    // Ignore storage errors.
  }
}

function DeathSaveDots({
  value,
  onChange,
  tone,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  tone: "success" | "failure";
  label: string;
}) {
  const filledClass =
    tone === "success"
      ? "bg-emerald-500 border-emerald-500 text-white dark:bg-emerald-500 dark:border-emerald-500"
      : "bg-rose-500 border-rose-500 text-white dark:bg-rose-500 dark:border-rose-500";
  const emptyClass =
    "border-zinc-300 bg-white text-transparent hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-500";

  return (
    <div className="mt-1 flex items-center gap-2">
      {Array.from({ length: DEATH_SAVE_MAX }, (_, index) => {
        const dotIndex = index + 1;
        const filled = dotIndex <= value;
        return (
          <button
            key={dotIndex}
            type="button"
            aria-label={`${label} ${dotIndex}`}
            aria-pressed={filled}
            onClick={() => onChange(value === dotIndex ? dotIndex - 1 : dotIndex)}
            className={`h-6 w-6 rounded-full border-2 transition ${filled ? filledClass : emptyClass}`}
          >
            <span className="sr-only">{filled ? "Filled" : "Empty"}</span>
          </button>
        );
      })}
    </div>
  );
}

function baseInputClassName() {
  return "mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-amber-500 dark:focus:ring-amber-900/50";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
      {label}
      {children}
    </label>
  );
}

function Card({
  title,
  description,
  className = "",
  defaultOpen = false,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  defaultOpen?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const showReorder = Boolean(onMoveUp || onMoveDown);

  return (
    <section
      className={`rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40 ${className}`.trim()}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg p-1 text-left transition hover:bg-zinc-100/70 dark:hover:bg-zinc-900/40"
          aria-expanded={isOpen}
        >
          <span
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 transition-transform dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 ${
              isOpen ? "rotate-90" : ""
            }`}
            aria-hidden="true"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
            {description ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
            ) : null}
          </div>
        </button>
        {showReorder ? (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label={`Move ${title} up`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label={`Move ${title} down`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      {isOpen ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function formatSavedAt(value: string | null) {
  if (!value) return "Not saved yet";
  return `Saved ${new Date(value).toLocaleString()}`;
}

export function CharacterSheetEditor({
  roomId,
  participantId,
  participantName,
}: CharacterSheetEditorProps) {
  const [initialState] = useState(() => {
    const sheet = createDefaultCharacterSheet();
    return {
      sheet,
      snapshot: JSON.stringify(sheet),
    };
  });
  const [sheet, setSheet] = useState<CharacterSheetData>(initialState.sheet);
  const [savedSnapshot, setSavedSnapshot] = useState(initialState.snapshot);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(() => [...DEFAULT_SECTION_ORDER]);

  const currentSnapshot = useMemo(() => JSON.stringify(sheet), [sheet]);
  const isDirty = currentSnapshot !== savedSnapshot;

  useEffect(() => {
    const stored = loadStoredSectionOrder();
    setSectionOrder(stored);
  }, []);

  const isCustomOrder = useMemo(
    () => sectionOrder.some((id, index) => id !== DEFAULT_SECTION_ORDER[index]),
    [sectionOrder]
  );

  function moveSection(id: SectionId, delta: -1 | 1) {
    setSectionOrder((prev) => {
      const idx = prev.indexOf(id);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      next.splice(target, 0, removed);
      persistSectionOrder(next);
      return next;
    });
  }

  function resetSectionOrder() {
    const defaults = [...DEFAULT_SECTION_ORDER];
    setSectionOrder(defaults);
    clearStoredSectionOrder();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSheet() {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `/api/rooms/${roomId}/character-sheet?participantId=${encodeURIComponent(participantId)}`
      );
      const payload = (await res.json()) as ApiResponse<{
        sheet: CharacterSheetData;
        updatedAt: string | null;
      }>;

      if (cancelled) {
        return;
      }

      if (payload.error || !payload.data) {
        setError(payload.error?.message ?? "Could not load your character sheet.");
        setLoading(false);
        return;
      }

      let nextSheet = normalizeCharacterSheet(payload.data.sheet);
      const storedDeathSaves = loadStoredDeathSaves(roomId, participantId);
      if (storedDeathSaves) {
        nextSheet = {
          ...nextSheet,
          health: {
            ...nextSheet.health,
            deathSaves: {
              successes: String(storedDeathSaves.successes),
              failures: String(storedDeathSaves.failures),
            },
          },
        };
      }
      setSheet(nextSheet);
      setSavedSnapshot(JSON.stringify(nextSheet));
      setLastSavedAt(payload.data.updatedAt ?? null);
      setLoading(false);
    }

    void loadSheet();

    return () => {
      cancelled = true;
    };
  }, [participantId, roomId]);

  function updateBasics(
    key: keyof CharacterSheetData["basics"],
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      basics: {
        ...prev.basics,
        [key]: value,
      },
    }));
  }

  function updateInspiration(
    key: keyof CharacterSheetData["inspiration"],
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      inspiration: {
        ...prev.inspiration,
        [key]: value,
      },
    }));
  }

  function updateCombat(
    key: keyof CharacterSheetData["combat"],
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      combat: {
        ...prev.combat,
        [key]: value,
      },
    }));
  }

  function updateHealth(
    group: keyof CharacterSheetData["health"],
    key: string,
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      health: {
        ...prev.health,
        [group]: {
          ...prev.health[group],
          [key]: value,
        },
      },
    }));
  }

  function setDeathSave(key: "successes" | "failures", next: number) {
    const clamped = clampDeathSave(next);
    setSheet((prev) => {
      const updated = {
        ...prev,
        health: {
          ...prev.health,
          deathSaves: {
            ...prev.health.deathSaves,
            [key]: String(clamped),
          },
        },
      };
      persistDeathSaves(roomId, participantId, {
        successes: clampDeathSave(updated.health.deathSaves.successes),
        failures: clampDeathSave(updated.health.deathSaves.failures),
      });
      return updated;
    });
  }

  function updateFeatures(
    key: keyof CharacterSheetData["features"],
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        [key]: value,
      },
    }));
  }

  function updateProficiencies(
    key: Exclude<keyof CharacterSheetData["proficiencies"], "armorTraining">,
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      proficiencies: {
        ...prev.proficiencies,
        [key]: value,
      },
    }));
  }

  function updateArmorTraining(key: (typeof ARMOR_TRAINING_FIELDS)[number]["key"], value: boolean) {
    setSheet((prev) => ({
      ...prev,
      proficiencies: {
        ...prev.proficiencies,
        armorTraining: {
          ...prev.proficiencies.armorTraining,
          [key]: value,
        },
      },
    }));
  }

  function updateAbility(
    ability: AbilityKey,
    key: "score" | "modifier" | "savingThrow",
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      abilities: {
        ...prev.abilities,
        [ability]: {
          ...prev.abilities[ability],
          [key]: value,
        },
      },
    }));
  }

  function updateAbilitySkill(ability: AbilityKey, skillKey: string, value: string) {
    setSheet((prev) => ({
      ...prev,
      abilities: {
        ...prev.abilities,
        [ability]: {
          ...prev.abilities[ability],
          skills: {
            ...prev.abilities[ability].skills,
            [skillKey]: value,
          },
        },
      },
    }));
  }

  function updateWeaponRow(index: number, key: keyof CharacterSheetData["weaponsAndCantrips"][number], value: string) {
    setSheet((prev) => ({
      ...prev,
      weaponsAndCantrips: prev.weaponsAndCantrips.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [key]: value,
            }
          : row
      ),
    }));
  }

  function addWeaponEntry() {
    setSheet((prev) => ({
      ...prev,
      weaponsAndCantrips: [...prev.weaponsAndCantrips, createWeaponRow()],
    }));
  }

  function removeWeaponEntry(index: number) {
    setSheet((prev) => ({
      ...prev,
      weaponsAndCantrips:
        prev.weaponsAndCantrips.length <= 1
          ? prev.weaponsAndCantrips
          : prev.weaponsAndCantrips.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  function updateNarrative(
    key: Exclude<keyof CharacterSheetData["narrative"], "coins">,
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      narrative: {
        ...prev.narrative,
        [key]: value,
      },
    }));
  }

  function updateCoin(
    key: keyof CharacterSheetData["narrative"]["coins"],
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      narrative: {
        ...prev.narrative,
        coins: {
          ...prev.narrative.coins,
          [key]: value,
        },
      },
    }));
  }

  function updateSpells(
    key: Exclude<keyof CharacterSheetData["spells"], "slots" | "prepared">,
    value: string
  ) {
    setSheet((prev) => ({
      ...prev,
      spells: {
        ...prev.spells,
        [key]: value,
      },
    }));
  }

  function updateSpellSlot(level: (typeof SPELL_SLOT_LEVELS)[number], key: "total" | "expended", value: string) {
    setSheet((prev) => ({
      ...prev,
      spells: {
        ...prev.spells,
        slots: {
          ...prev.spells.slots,
          [level]: {
            ...prev.spells.slots[level],
            [key]: value,
          },
        },
      },
    }));
  }

  function updateSpellRow(
    index: number,
    key: keyof CharacterSheetData["spells"]["prepared"][number],
    value: string | boolean
  ) {
    setSheet((prev) => ({
      ...prev,
      spells: {
        ...prev.spells,
        prepared: prev.spells.prepared.map((row, rowIndex) =>
          rowIndex === index
            ? {
                ...row,
                [key]: value,
              }
            : row
        ),
      },
    }));
  }

  function addSpellEntry() {
    setSheet((prev) => ({
      ...prev,
      spells: {
        ...prev.spells,
        prepared: [...prev.spells.prepared, createSpellRow()],
      },
    }));
  }

  function removeSpellEntry(index: number) {
    setSheet((prev) => ({
      ...prev,
      spells: {
        ...prev.spells,
        prepared:
          prev.spells.prepared.length <= 1
            ? prev.spells.prepared
            : prev.spells.prepared.filter((_, rowIndex) => rowIndex !== index),
      },
    }));
  }

  async function saveSheet() {
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/rooms/${roomId}/character-sheet`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId,
        sheet,
      }),
    });
    const payload = (await res.json()) as ApiResponse<{
      sheet: CharacterSheetData;
      updatedAt: string | null;
    }>;

    if (payload.error || !payload.data) {
      setError(payload.error?.message ?? "Could not save your character sheet.");
      setSaving(false);
      return;
    }

    const nextSheet = normalizeCharacterSheet(payload.data.sheet);
    setSheet(nextSheet);
    setSavedSnapshot(JSON.stringify(nextSheet));
    setLastSavedAt(payload.data.updatedAt ?? null);
    setSaving(false);
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm dark:border-amber-900/60 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg p-1 text-left transition hover:bg-amber-50/50 dark:hover:bg-amber-950/20"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse character sheet" : "Expand character sheet"}
        >
          <span
            className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 transition-transform dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 ${
              isExpanded ? "rotate-90" : ""
            }`}
            aria-hidden="true"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Character sheet
              {sheet.basics.characterName ? (
                <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  · {sheet.basics.characterName}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {isExpanded
                ? `${participantName} can edit this sheet in this room. The fields follow the uploaded DnD PDF.`
                : "Click to open and edit your character sheet."}
            </p>
          </div>
        </button>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              isDirty
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
            }`}
          >
            {isDirty ? "Unsaved changes" : formatSavedAt(lastSavedAt)}
          </span>
          <button
            type="button"
            onClick={() => void saveSheet()}
            disabled={loading || saving || !isDirty}
            className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {saving ? "Saving..." : "Save sheet"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      {loading && isExpanded ? <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Loading character sheet...</p> : null}

      {!loading && isExpanded ? (() => {
        const sectionContent: Record<SectionId, ReactNode> = {
          identity: (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Character name">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.characterName}
                  onChange={(event) => updateBasics("characterName", event.target.value)}
                />
              </Field>
              <Field label="Background">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.background}
                  onChange={(event) => updateBasics("background", event.target.value)}
                />
              </Field>
              <Field label="Species">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.species}
                  onChange={(event) => updateBasics("species", event.target.value)}
                />
              </Field>
              <Field label="Subclass">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.subclass}
                  onChange={(event) => updateBasics("subclass", event.target.value)}
                />
              </Field>
              <Field label="Class">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.className}
                  onChange={(event) => updateBasics("className", event.target.value)}
                />
              </Field>
              <Field label="Class level">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.classLevel}
                  onChange={(event) => updateBasics("classLevel", event.target.value)}
                />
              </Field>
              <Field label="XP shield">
                <input
                  className={baseInputClassName()}
                  value={sheet.basics.xpShield}
                  onChange={(event) => updateBasics("xpShield", event.target.value)}
                />
              </Field>
              <Field label="Alignment">
                <input
                  className={baseInputClassName()}
                  value={sheet.narrative.alignment}
                  onChange={(event) => updateNarrative("alignment", event.target.value)}
                />
              </Field>
            </div>
          ),
          combat: (
            <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Armor class">
                <input
                  className={baseInputClassName()}
                  value={sheet.combat.armorClass}
                  onChange={(event) => updateCombat("armorClass", event.target.value)}
                />
              </Field>
              <Field label="Initiative">
                <input
                  className={baseInputClassName()}
                  value={sheet.combat.initiative}
                  onChange={(event) => updateCombat("initiative", event.target.value)}
                />
              </Field>
              <Field label="Speed">
                <input
                  className={baseInputClassName()}
                  value={sheet.combat.speed}
                  onChange={(event) => updateCombat("speed", event.target.value)}
                />
              </Field>
              <Field label="Size">
                <input
                  className={baseInputClassName()}
                  value={sheet.combat.size}
                  onChange={(event) => updateCombat("size", event.target.value)}
                />
              </Field>
              <Field label="Passive perception">
                <input
                  className={baseInputClassName()}
                  value={sheet.combat.passivePerception}
                  onChange={(event) => updateCombat("passivePerception", event.target.value)}
                />
              </Field>
              <Field label="Proficiency bonus">
                <input
                  className={baseInputClassName()}
                  value={sheet.inspiration.proficiencyBonus}
                  onChange={(event) => updateInspiration("proficiencyBonus", event.target.value)}
                />
              </Field>
              <Field label="Heroic inspiration">
                <input
                  className={baseInputClassName()}
                  value={sheet.inspiration.heroicInspiration}
                  onChange={(event) => updateInspiration("heroicInspiration", event.target.value)}
                />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="HP current">
                <input
                  className={baseInputClassName()}
                  value={sheet.health.hitPoints.current}
                  onChange={(event) => updateHealth("hitPoints", "current", event.target.value)}
                />
              </Field>
              <Field label="HP temp">
                <input
                  className={baseInputClassName()}
                  value={sheet.health.hitPoints.temp}
                  onChange={(event) => updateHealth("hitPoints", "temp", event.target.value)}
                />
              </Field>
              <Field label="HP max">
                <input
                  className={baseInputClassName()}
                  value={sheet.health.hitPoints.max}
                  onChange={(event) => updateHealth("hitPoints", "max", event.target.value)}
                />
              </Field>
              <Field label="Hit dice max">
                <input
                  className={baseInputClassName()}
                  value={sheet.health.hitDice.max}
                  onChange={(event) => updateHealth("hitDice", "max", event.target.value)}
                />
              </Field>
              <Field label="Hit dice spent">
                <input
                  className={baseInputClassName()}
                  value={sheet.health.hitDice.spent}
                  onChange={(event) => updateHealth("hitDice", "spent", event.target.value)}
                />
              </Field>
              <Field label="Death save successes">
                <DeathSaveDots
                  tone="success"
                  label="Death save success"
                  value={clampDeathSave(sheet.health.deathSaves.successes)}
                  onChange={(next) => setDeathSave("successes", next)}
                />
              </Field>
              <Field label="Death save failures">
                <DeathSaveDots
                  tone="failure"
                  label="Death save failure"
                  value={clampDeathSave(sheet.health.deathSaves.failures)}
                  onChange={(next) => setDeathSave("failures", next)}
                />
              </Field>
            </div>
            </>
          ),
          abilities: (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ABILITY_KEYS.map((ability) => (
                <div
                  key={ability}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {ABILITY_LABELS[ability]}
                    <span className="ml-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      ({ABILITY_SHORT_LABELS[ability]})
                    </span>
                  </h4>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label="Score">
                      <input
                        className={baseInputClassName()}
                        value={sheet.abilities[ability].score}
                        onChange={(event) => updateAbility(ability, "score", event.target.value)}
                      />
                    </Field>
                    <Field label="Modifier">
                      <input
                        className={baseInputClassName()}
                        value={sheet.abilities[ability].modifier}
                        onChange={(event) => updateAbility(ability, "modifier", event.target.value)}
                      />
                    </Field>
                    <Field label="Save">
                      <input
                        className={baseInputClassName()}
                        value={sheet.abilities[ability].savingThrow}
                        onChange={(event) => updateAbility(ability, "savingThrow", event.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          ),
          skills: (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SKILL_ROWS.map((skill) => (
                <Field
                  key={skill.key}
                  label={`${skill.label} (${ABILITY_SHORT_LABELS[skill.ability]})`}
                >
                  <input
                    className={baseInputClassName()}
                    value={sheet.abilities[skill.ability].skills[skill.key]}
                    onChange={(event) => updateAbilitySkill(skill.ability, skill.key, event.target.value)}
                  />
                </Field>
              ))}
            </div>
          ),
          features: (
            <div className="space-y-4">
              <Field label="Species traits">
                <textarea
                  className={`${baseInputClassName()} min-h-28`}
                  value={sheet.features.speciesTraits}
                  onChange={(event) => updateFeatures("speciesTraits", event.target.value)}
                />
              </Field>
              <Field label="Feats">
                <textarea
                  className={`${baseInputClassName()} min-h-24`}
                  value={sheet.features.feats}
                  onChange={(event) => updateFeatures("feats", event.target.value)}
                />
              </Field>
              <Field label="Class features">
                <textarea
                  className={`${baseInputClassName()} min-h-28`}
                  value={sheet.features.classFeatures}
                  onChange={(event) => updateFeatures("classFeatures", event.target.value)}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Weapon training">
                  <textarea
                    className={`${baseInputClassName()} min-h-24`}
                    value={sheet.proficiencies.weapons}
                    onChange={(event) => updateProficiencies("weapons", event.target.value)}
                  />
                </Field>
                <Field label="Tool training">
                  <textarea
                    className={`${baseInputClassName()} min-h-24`}
                    value={sheet.proficiencies.tools}
                    onChange={(event) => updateProficiencies("tools", event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Languages">
                <textarea
                  className={`${baseInputClassName()} min-h-20`}
                  value={sheet.proficiencies.languages}
                  onChange={(event) => updateProficiencies("languages", event.target.value)}
                />
              </Field>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  Armor training
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {ARMOR_TRAINING_FIELDS.map((field) => (
                    <label
                      key={field.key}
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      <input
                        type="checkbox"
                        checked={sheet.proficiencies.armorTraining[field.key]}
                        onChange={(event) => updateArmorTraining(field.key, event.target.checked)}
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ),
          narrative: (
            <div className="space-y-4">
              <Field label="Appearance">
                <textarea
                  className={`${baseInputClassName()} min-h-24`}
                  value={sheet.narrative.appearance}
                  onChange={(event) => updateNarrative("appearance", event.target.value)}
                />
              </Field>
              <Field label="Backstory & personality">
                <textarea
                  className={`${baseInputClassName()} min-h-32`}
                  value={sheet.narrative.backstoryAndPersonality}
                  onChange={(event) => updateNarrative("backstoryAndPersonality", event.target.value)}
                />
              </Field>
              <Field label="Equipment">
                <textarea
                  className={`${baseInputClassName()} min-h-28`}
                  value={sheet.narrative.equipment}
                  onChange={(event) => updateNarrative("equipment", event.target.value)}
                />
              </Field>
              <Field label="Magic item attunement">
                <textarea
                  className={`${baseInputClassName()} min-h-20`}
                  value={sheet.narrative.magicItemAttunement}
                  onChange={(event) => updateNarrative("magicItemAttunement", event.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-5">
                {(["cp", "sp", "ep", "gp", "pp"] as const).map((coin) => (
                  <Field key={coin} label={coin.toUpperCase()}>
                    <input
                      className={baseInputClassName()}
                      value={sheet.narrative.coins[coin]}
                      onChange={(event) => updateCoin(coin, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
            </div>
          ),
          weapons: (
            <div className="space-y-3">
              {sheet.weaponsAndCantrips.map((weapon, index) => (
                <div
                  key={weapon.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Entry {index + 1}</p>
                    <button
                      type="button"
                      className="text-xs font-semibold text-rose-600 disabled:cursor-not-allowed disabled:text-zinc-400"
                      onClick={() => removeWeaponEntry(index)}
                      disabled={sheet.weaponsAndCantrips.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-4">
                    <Field label="Name">
                      <input
                        className={baseInputClassName()}
                        value={weapon.name}
                        onChange={(event) => updateWeaponRow(index, "name", event.target.value)}
                      />
                    </Field>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Attack bonus / DC">
                        <input
                          className={baseInputClassName()}
                          value={weapon.attackBonusOrDc}
                          onChange={(event) => updateWeaponRow(index, "attackBonusOrDc", event.target.value)}
                        />
                      </Field>
                      <Field label="Damage & type">
                        <input
                          className={baseInputClassName()}
                          value={weapon.damageAndType}
                          onChange={(event) => updateWeaponRow(index, "damageAndType", event.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Notes">
                      <textarea
                        className={`${baseInputClassName()} min-h-20`}
                        value={weapon.notes}
                        onChange={(event) => updateWeaponRow(index, "notes", event.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={addWeaponEntry}
              >
                Add weapon / cantrip row
              </button>
            </div>
          ),
          spellcasting: (
            <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Spell attack bonus">
                <input
                  className={baseInputClassName()}
                  value={sheet.spells.spellAttackBonus}
                  onChange={(event) => updateSpells("spellAttackBonus", event.target.value)}
                />
              </Field>
              <Field label="Spell save DC">
                <input
                  className={baseInputClassName()}
                  value={sheet.spells.spellSaveDc}
                  onChange={(event) => updateSpells("spellSaveDc", event.target.value)}
                />
              </Field>
              <Field label="Spellcasting modifier">
                <input
                  className={baseInputClassName()}
                  value={sheet.spells.spellcastingModifier}
                  onChange={(event) => updateSpells("spellcastingModifier", event.target.value)}
                />
              </Field>
              <Field label="Spellcasting ability">
                <input
                  className={baseInputClassName()}
                  value={sheet.spells.spellcastingAbility}
                  onChange={(event) => updateSpells("spellcastingAbility", event.target.value)}
                />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              {SPELL_SLOT_LEVELS.map((level) => (
                <div
                  key={level}
                  className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Level {level}</p>
                  <Field label="Total">
                    <input
                      className={baseInputClassName()}
                      value={sheet.spells.slots[level].total}
                      onChange={(event) => updateSpellSlot(level, "total", event.target.value)}
                    />
                  </Field>
                  <Field label="Expended">
                    <input
                      className={baseInputClassName()}
                      value={sheet.spells.slots[level].expended}
                      onChange={(event) => updateSpellSlot(level, "expended", event.target.value)}
                    />
                  </Field>
                </div>
              ))}
            </div>

            <Field label="Spell notes">
              <textarea
                className={`${baseInputClassName()} mt-4 min-h-24`}
                value={sheet.spells.notes}
                onChange={(event) => updateSpells("notes", event.target.value)}
              />
            </Field>

            <div className="mt-5 space-y-3">
              {sheet.spells.prepared.map((spell, index) => (
                <div
                  key={spell.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Spell row {index + 1}</p>
                    <button
                      type="button"
                      className="text-xs font-semibold text-rose-600 disabled:cursor-not-allowed disabled:text-zinc-400"
                      onClick={() => removeSpellEntry(index)}
                      disabled={sheet.spells.prepared.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr_0.7fr]">
                    <Field label="Casting time & duration">
                      <input
                        className={baseInputClassName()}
                        value={spell.castingTimeAndDuration}
                        onChange={(event) =>
                          updateSpellRow(index, "castingTimeAndDuration", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Name">
                      <input
                        className={baseInputClassName()}
                        value={spell.name}
                        onChange={(event) => updateSpellRow(index, "name", event.target.value)}
                      />
                    </Field>
                    <Field label="Level">
                      <input
                        className={baseInputClassName()}
                        value={spell.level}
                        onChange={(event) => updateSpellRow(index, "level", event.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_auto_auto]">
                    <Field label="Required material / notes">
                      <textarea
                        className={`${baseInputClassName()} min-h-20`}
                        value={spell.material}
                        onChange={(event) => updateSpellRow(index, "material", event.target.value)}
                      />
                    </Field>
                    <label className="flex items-center gap-2 self-end rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                      <input
                        type="checkbox"
                        checked={spell.concentration}
                        onChange={(event) => updateSpellRow(index, "concentration", event.target.checked)}
                      />
                      <span>Concentration</span>
                    </label>
                    <label className="flex items-center gap-2 self-end rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                      <input
                        type="checkbox"
                        checked={spell.ritual}
                        onChange={(event) => updateSpellRow(index, "ritual", event.target.checked)}
                      />
                      <span>Ritual</span>
                    </label>
                  </div>
                  <Field label="Notes">
                    <textarea
                      className={`${baseInputClassName()} min-h-20`}
                      value={spell.notes}
                      onChange={(event) => updateSpellRow(index, "notes", event.target.value)}
                    />
                  </Field>
                </div>
              ))}
              <button
                type="button"
                className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                onClick={addSpellEntry}
              >
                Add spell row
              </button>
            </div>
            </>
          ),
        };

        return (
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Use the arrows on each card to reorder sections. Your layout is saved in this browser.</span>
              {isCustomOrder ? (
                <button
                  type="button"
                  onClick={resetSectionOrder}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Reset to default order
                </button>
              ) : null}
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              {sectionOrder.map((id, index) => {
                const meta = SECTION_META[id];
                return (
                  <Card
                    key={id}
                    title={meta.title}
                    description={meta.description}
                    className={meta.className}
                    canMoveUp={index > 0}
                    canMoveDown={index < sectionOrder.length - 1}
                    onMoveUp={() => moveSection(id, -1)}
                    onMoveDown={() => moveSection(id, 1)}
                  >
                    {sectionContent[id]}
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })() : null}
    </section>
  );
}
