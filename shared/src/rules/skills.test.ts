import { describe, expect, it } from 'vitest';
import { CLASS_IDS } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { cooldownFor, cooldownScore, isSkillUnlocked, powerPerTurn } from './skills.ts';

const { skills, elements } = gameData;

describe('recharges (onglet Bases, colonnes H et P)', () => {
  it('reproduit le score et la recharge des 79 compétences de base', () => {
    for (const base of skills.bases) {
      expect(cooldownScore(skills, base), base.id).toBe(base.cooldownScore);
      expect(cooldownFor(skills, base), base.id).toBe(base.cooldown);
    }
  });

  it('le kit de départ n’a aucune recharge, les ultimes ont 3', () => {
    for (const base of skills.bases.filter((b) => b.family !== 'passive')) {
      if (base.requiredLevel === 1) expect(base.cooldown, base.id).toBe(0);
      if (base.ultimate && base.requiredLevel > 1) expect(base.cooldown, base.id).toBe(3);
    }
  });
});

describe('catalogue des compétences (484 variantes)', () => {
  it('chaque variante reprend sa base et l’étage de déblocage de son élément', () => {
    for (const skill of skills.catalog) {
      const base = skills.bases.find((b) => b.id === skill.baseId)!;
      expect(skill.cooldown, skill.id).toBe(base.cooldown);
      expect(skill.power, skill.id).toBe(base.power);
      expect(skill.requiredLevel, skill.id).toBe(base.requiredLevel);
      if (base.family !== 'passive') {
        const element = elements.elements.find((e) => e.id === skill.element)!;
        expect(skill.unlockFloor, skill.id).toBe(element.unlockFloor);
        const expectedName =
          element.skillVariantSuffix === null
            ? base.name
            : `${base.variantRoot} ${element.skillVariantSuffix}`;
        expect(skill.name, skill.id).toBe(expectedName);
      }
    }
  });

  it('reproduit la puissance par tour (colonne S)', () => {
    for (const skill of skills.catalog) {
      expect(powerPerTurn(skills, skill), skill.id).toBeCloseTo(skill.powerPerTurn, 12);
    }
  });

  it('une compétence demande le niveau requis et son élément débloqué', () => {
    const fireExecution = skills.catalog.find((s) => s.id === 'GUE-A07-FEU')!;
    expect(isSkillUnlocked(fireExecution, 30, ['neutral', 'earth', 'fire'])).toBe(true);
    expect(isSkillUnlocked(fireExecution, 29, ['neutral', 'earth', 'fire'])).toBe(false);
    expect(isSkillUnlocked(fireExecution, 60, ['neutral', 'earth'])).toBe(false);
  });
});

describe('kit de départ (onglet Déblocages)', () => {
  it('2 actives sans recharge + 1 passif en Neutre, par classe', () => {
    for (const classId of CLASS_IDS) {
      const kit = skills.starterKits.find((k) => k.classId === classId)!;
      const level1 = skills.bases.filter((b) => b.classId === classId && b.requiredLevel === 1);
      expect(level1.filter((b) => b.family !== 'passive').map((b) => b.name)).toEqual([
        kit.active1,
        kit.active2,
      ]);
      expect(level1.filter((b) => b.family === 'passive').map((b) => b.name)).toEqual([
        kit.passive,
      ]);
    }
    const warrior = skills.starterKits.find((k) => k.classId === 'warrior')!;
    expect([warrior.active1, warrior.active2, warrior.passive]).toEqual([
      'Frappe rapide',
      "Coup d'estoc",
      'Peau dure',
    ]);
  });

  it('équipe 3 actives + 2 passives, une seule ultime, 3 actions par manche', () => {
    expect(skills.params).toMatchObject({
      activeSlots: 3,
      passiveSlots: 2,
      maxUltimates: 1,
      soloActionsPerRound: 3,
      multiActionsPerRound: 3,
      usesPerRound: 1,
    });
  });
});
