export const ABILITY_KEYS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;

export type AbilityKey = (typeof ABILITY_KEYS)[number];

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

export const ABILITY_SHORT_LABELS: Record<AbilityKey, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
  charisma: "CHA",
};

export const SKILL_ROWS = [
  { key: "athletics", label: "Athletics", ability: "strength" },
  { key: "acrobatics", label: "Acrobatics", ability: "dexterity" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dexterity" },
  { key: "stealth", label: "Stealth", ability: "dexterity" },
  { key: "arcana", label: "Arcana", ability: "intelligence" },
  { key: "history", label: "History", ability: "intelligence" },
  { key: "investigation", label: "Investigation", ability: "intelligence" },
  { key: "nature", label: "Nature", ability: "intelligence" },
  { key: "religion", label: "Religion", ability: "intelligence" },
  { key: "animalHandling", label: "Animal Handling", ability: "wisdom" },
  { key: "insight", label: "Insight", ability: "wisdom" },
  { key: "medicine", label: "Medicine", ability: "wisdom" },
  { key: "perception", label: "Perception", ability: "wisdom" },
  { key: "survival", label: "Survival", ability: "wisdom" },
  { key: "deception", label: "Deception", ability: "charisma" },
  { key: "intimidation", label: "Intimidation", ability: "charisma" },
  { key: "performance", label: "Performance", ability: "charisma" },
  { key: "persuasion", label: "Persuasion", ability: "charisma" },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  ability: AbilityKey;
}>;

export type SkillKey = (typeof SKILL_ROWS)[number]["key"];

export const ARMOR_TRAINING_FIELDS = [
  { key: "light", label: "Light" },
  { key: "medium", label: "Medium" },
  { key: "heavy", label: "Heavy" },
  { key: "shields", label: "Shields" },
] as const;

export type ArmorTrainingKey = (typeof ARMOR_TRAINING_FIELDS)[number]["key"];

export const SPELL_SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type SpellSlotLevel = (typeof SPELL_SLOT_LEVELS)[number];

export type WeaponRow = {
  id: string;
  name: string;
  attackBonusOrDc: string;
  damageAndType: string;
  notes: string;
};

export type SpellRow = {
  id: string;
  castingTimeAndDuration: string;
  name: string;
  level: string;
  concentration: boolean;
  ritual: boolean;
  material: string;
  notes: string;
};

export type SpellSlot = {
  total: string;
  expended: string;
};

export type AbilityBlock = {
  score: string;
  modifier: string;
  savingThrow: string;
  skills: Record<SkillKey, string>;
};

export type CharacterSheetData = {
  basics: {
    characterName: string;
    background: string;
    species: string;
    subclass: string;
    className: string;
    classLevel: string;
    xpShield: string;
  };
  inspiration: {
    heroicInspiration: string;
    proficiencyBonus: string;
  };
  combat: {
    armorClass: string;
    initiative: string;
    speed: string;
    size: string;
    passivePerception: string;
  };
  health: {
    hitPoints: {
      current: string;
      temp: string;
      max: string;
    };
    hitDice: {
      max: string;
      spent: string;
    };
    deathSaves: {
      successes: string;
      failures: string;
    };
  };
  abilities: Record<AbilityKey, AbilityBlock>;
  features: {
    speciesTraits: string;
    feats: string;
    classFeatures: string;
  };
  proficiencies: {
    armorTraining: Record<ArmorTrainingKey, boolean>;
    weapons: string;
    tools: string;
    languages: string;
  };
  weaponsAndCantrips: WeaponRow[];
  narrative: {
    appearance: string;
    alignment: string;
    backstoryAndPersonality: string;
    equipment: string;
    magicItemAttunement: string;
    coins: {
      cp: string;
      sp: string;
      ep: string;
      gp: string;
      pp: string;
    };
  };
  spells: {
    notes: string;
    spellAttackBonus: string;
    spellSaveDc: string;
    spellcastingModifier: string;
    spellcastingAbility: string;
    slots: Record<SpellSlotLevel, SpellSlot>;
    prepared: SpellRow[];
  };
};

const WEAPON_ROW_MIN_COUNT = 6;
const SPELL_ROW_MIN_COUNT = 12;

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sheet-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWeaponRow(): WeaponRow {
  return {
    id: createId(),
    name: "",
    attackBonusOrDc: "",
    damageAndType: "",
    notes: "",
  };
}

export function createSpellRow(): SpellRow {
  return {
    id: createId(),
    castingTimeAndDuration: "",
    name: "",
    level: "",
    concentration: false,
    ritual: false,
    material: "",
    notes: "",
  };
}

function emptySkills(): Record<SkillKey, string> {
  return Object.fromEntries(SKILL_ROWS.map((skill) => [skill.key, ""])) as Record<SkillKey, string>;
}

function createAbilityBlock(): AbilityBlock {
  return {
    score: "",
    modifier: "",
    savingThrow: "",
    skills: emptySkills(),
  };
}

function createSpellSlots(): Record<SpellSlotLevel, SpellSlot> {
  return Object.fromEntries(
    SPELL_SLOT_LEVELS.map((level) => [
      level,
      {
        total: "",
        expended: "",
      },
    ])
  ) as Record<SpellSlotLevel, SpellSlot>;
}

function createAbilities(): Record<AbilityKey, AbilityBlock> {
  return Object.fromEntries(
    ABILITY_KEYS.map((ability) => [ability, createAbilityBlock()])
  ) as Record<AbilityKey, AbilityBlock>;
}

function createArmorTraining(): Record<ArmorTrainingKey, boolean> {
  return Object.fromEntries(
    ARMOR_TRAINING_FIELDS.map((field) => [field.key, false])
  ) as Record<ArmorTrainingKey, boolean>;
}

export function createDefaultCharacterSheet(): CharacterSheetData {
  return {
    basics: {
      characterName: "",
      background: "",
      species: "",
      subclass: "",
      className: "",
      classLevel: "",
      xpShield: "",
    },
    inspiration: {
      heroicInspiration: "",
      proficiencyBonus: "",
    },
    combat: {
      armorClass: "",
      initiative: "",
      speed: "",
      size: "",
      passivePerception: "",
    },
    health: {
      hitPoints: {
        current: "",
        temp: "",
        max: "",
      },
      hitDice: {
        max: "",
        spent: "",
      },
      deathSaves: {
        successes: "",
        failures: "",
      },
    },
    abilities: createAbilities(),
    features: {
      speciesTraits: "",
      feats: "",
      classFeatures: "",
    },
    proficiencies: {
      armorTraining: createArmorTraining(),
      weapons: "",
      tools: "",
      languages: "",
    },
    weaponsAndCantrips: Array.from({ length: WEAPON_ROW_MIN_COUNT }, () => createWeaponRow()),
    narrative: {
      appearance: "",
      alignment: "",
      backstoryAndPersonality: "",
      equipment: "",
      magicItemAttunement: "",
      coins: {
        cp: "",
        sp: "",
        ep: "",
        gp: "",
        pp: "",
      },
    },
    spells: {
      notes: "",
      spellAttackBonus: "",
      spellSaveDc: "",
      spellcastingModifier: "",
      spellcastingAbility: "",
      slots: createSpellSlots(),
      prepared: Array.from({ length: SPELL_ROW_MIN_COUNT }, () => createSpellRow()),
    },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown) {
  return value === true;
}

function normalizeWeaponRows(value: unknown) {
  const rows = Array.isArray(value)
    ? value
        .map((row) => {
          const entry = asObject(row);
          if (!entry) return null;
          return {
            id: readString(entry.id) || createId(),
            name: readString(entry.name),
            attackBonusOrDc: readString(entry.attackBonusOrDc),
            damageAndType: readString(entry.damageAndType),
            notes: readString(entry.notes),
          } satisfies WeaponRow;
        })
        .filter((row): row is WeaponRow => row !== null)
    : [];

  while (rows.length < WEAPON_ROW_MIN_COUNT) {
    rows.push(createWeaponRow());
  }

  return rows;
}

function normalizeSpellRows(value: unknown) {
  const rows = Array.isArray(value)
    ? value
        .map((row) => {
          const entry = asObject(row);
          if (!entry) return null;
          return {
            id: readString(entry.id) || createId(),
            castingTimeAndDuration: readString(entry.castingTimeAndDuration),
            name: readString(entry.name),
            level: readString(entry.level),
            concentration: readBoolean(entry.concentration),
            ritual: readBoolean(entry.ritual),
            material: readString(entry.material),
            notes: readString(entry.notes),
          } satisfies SpellRow;
        })
        .filter((row): row is SpellRow => row !== null)
    : [];

  while (rows.length < SPELL_ROW_MIN_COUNT) {
    rows.push(createSpellRow());
  }

  return rows;
}

function normalizeAbilityBlock(value: unknown): AbilityBlock {
  const entry = asObject(value);
  const base = createAbilityBlock();

  if (!entry) {
    return base;
  }

  const skillsEntry = asObject(entry.skills);
  const skills = { ...base.skills };
  for (const skill of SKILL_ROWS) {
    skills[skill.key] = readString(skillsEntry?.[skill.key]);
  }

  return {
    score: readString(entry.score),
    modifier: readString(entry.modifier),
    savingThrow: readString(entry.savingThrow),
    skills,
  };
}

function normalizeSpellSlots(value: unknown): Record<SpellSlotLevel, SpellSlot> {
  const entry = asObject(value);
  const slots = createSpellSlots();

  for (const level of SPELL_SLOT_LEVELS) {
    const slot = asObject(entry?.[String(level)] ?? entry?.[level]);
    slots[level] = {
      total: readString(slot?.total),
      expended: readString(slot?.expended),
    };
  }

  return slots;
}

export function normalizeCharacterSheet(value: unknown): CharacterSheetData {
  const entry = asObject(value);
  const defaults = createDefaultCharacterSheet();

  if (!entry) {
    return defaults;
  }

  const basics = asObject(entry.basics);
  const inspiration = asObject(entry.inspiration);
  const combat = asObject(entry.combat);
  const health = asObject(entry.health);
  const hitPoints = asObject(health?.hitPoints);
  const hitDice = asObject(health?.hitDice);
  const deathSaves = asObject(health?.deathSaves);
  const abilities = asObject(entry.abilities);
  const features = asObject(entry.features);
  const proficiencies = asObject(entry.proficiencies);
  const armorTraining = asObject(proficiencies?.armorTraining);
  const narrative = asObject(entry.narrative);
  const coins = asObject(narrative?.coins);
  const spells = asObject(entry.spells);

  return {
    basics: {
      characterName: readString(basics?.characterName),
      background: readString(basics?.background),
      species: readString(basics?.species),
      subclass: readString(basics?.subclass),
      className: readString(basics?.className),
      classLevel: readString(basics?.classLevel),
      xpShield: readString(basics?.xpShield),
    },
    inspiration: {
      heroicInspiration: readString(inspiration?.heroicInspiration),
      proficiencyBonus: readString(inspiration?.proficiencyBonus),
    },
    combat: {
      armorClass: readString(combat?.armorClass),
      initiative: readString(combat?.initiative),
      speed: readString(combat?.speed),
      size: readString(combat?.size),
      passivePerception: readString(combat?.passivePerception),
    },
    health: {
      hitPoints: {
        current: readString(hitPoints?.current),
        temp: readString(hitPoints?.temp),
        max: readString(hitPoints?.max),
      },
      hitDice: {
        max: readString(hitDice?.max),
        spent: readString(hitDice?.spent),
      },
      deathSaves: {
        successes: readString(deathSaves?.successes),
        failures: readString(deathSaves?.failures),
      },
    },
    abilities: {
      strength: normalizeAbilityBlock(abilities?.strength),
      dexterity: normalizeAbilityBlock(abilities?.dexterity),
      constitution: normalizeAbilityBlock(abilities?.constitution),
      intelligence: normalizeAbilityBlock(abilities?.intelligence),
      wisdom: normalizeAbilityBlock(abilities?.wisdom),
      charisma: normalizeAbilityBlock(abilities?.charisma),
    },
    features: {
      speciesTraits: readString(features?.speciesTraits),
      feats: readString(features?.feats),
      classFeatures: readString(features?.classFeatures),
    },
    proficiencies: {
      armorTraining: {
        light: readBoolean(armorTraining?.light),
        medium: readBoolean(armorTraining?.medium),
        heavy: readBoolean(armorTraining?.heavy),
        shields: readBoolean(armorTraining?.shields),
      },
      weapons: readString(proficiencies?.weapons),
      tools: readString(proficiencies?.tools),
      languages: readString(proficiencies?.languages),
    },
    weaponsAndCantrips: normalizeWeaponRows(entry.weaponsAndCantrips),
    narrative: {
      appearance: readString(narrative?.appearance),
      alignment: readString(narrative?.alignment),
      backstoryAndPersonality: readString(narrative?.backstoryAndPersonality),
      equipment: readString(narrative?.equipment),
      magicItemAttunement: readString(narrative?.magicItemAttunement),
      coins: {
        cp: readString(coins?.cp),
        sp: readString(coins?.sp),
        ep: readString(coins?.ep),
        gp: readString(coins?.gp),
        pp: readString(coins?.pp),
      },
    },
    spells: {
      notes: readString(spells?.notes),
      spellAttackBonus: readString(spells?.spellAttackBonus),
      spellSaveDc: readString(spells?.spellSaveDc),
      spellcastingModifier: readString(spells?.spellcastingModifier),
      spellcastingAbility: readString(spells?.spellcastingAbility),
      slots: normalizeSpellSlots(spells?.slots),
      prepared: normalizeSpellRows(spells?.prepared),
    },
  };
}
