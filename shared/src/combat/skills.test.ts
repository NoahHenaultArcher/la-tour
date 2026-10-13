import { describe, expect, it } from 'vitest';
import type { ClassId, ElementId } from '../constants.ts';
import { gameData } from '../data/index.ts';
import { applyAlteration } from './alterations.ts';
import { attack } from './damage.ts';
import { createCombat, endHeroTurn, normalizeCombatState, performHeroAction } from './engine.ts';
import type { HeroSetup } from './setup.ts';
import type { CombatEvent, CombatState } from './types.ts';

const data = gameData;

type Deck = HeroSetup['deck'];

function hero(classId: ClassId, level: number, deck: Deck): HeroSetup {
  return { characterId: `char-${classId}`, classId, level, heritageCount: 0, equipment: [], deck };
}

/** Combat où le héros a la main dès la première manche (étage 1, héros de haut niveau). */
function start(classId: ClassId, deck: Deck, options: { level?: number; seed?: number } = {}) {
  return createCombat(data, {
    floor: 1,
    heroes: [hero(classId, options.level ?? 60, deck)],
    tower: {},
    seed: options.seed ?? 7,
  }).state;
}

const act = (state: CombatState, skillId: string, targetId?: string) =>
  performHeroAction(data, state, { heroId: 'h0', skillId, targetId });
const firstMonster = (state: CombatState) => state.monsters.find((m) => m.hp > 0)!;

describe('soutiens', () => {
  it('Soin : rend 18 % des PV max (Bonus de soins compris), sans cible', () => {
    let state = start('mage', [
      { position: 0, skillId: 'MAG-A01-NEU' },
      { position: 1, skillId: 'MAG-S02-NEU' },
    ]);
    const mage = state.heroes[0]!;
    mage.hp = Math.round(mage.stats.maxHp / 2);
    const result = act(state, 'MAG-S02-NEU');
    state = result.state;
    const heal = result.events.find((e) => e.type === 'heal' && e.targetId === 'h0');
    expect(heal).toMatchObject({
      amount: Math.round(mage.stats.maxHp * 0.18 * (1 + mage.stats.healingBonus)),
    });
  });

  it('Mur de boucliers : bouclier de 15 % des PV max qui absorbe, puis expire après 2 manches', () => {
    let state = start('warrior', [
      { position: 0, skillId: 'GUE-A01-NEU' },
      { position: 1, skillId: 'GUE-S04-NEU' },
    ]);
    state = act(state, 'GUE-S04-NEU').state;
    const warrior = state.heroes[0]!;
    expect(warrior.shield).toBe(Math.round(warrior.stats.maxHp * 0.15));
    expect(warrior.shieldRemaining).toBe(2);
    // Deux fins de manche plus tard, le bouclier restant disparaît.
    state = endHeroTurn(data, state).state;
    if (state.phase === 'heroes') state = endHeroTurn(data, state).state;
    if (state.phase === 'heroes') expect(state.heroes[0]!.shield).toBe(0);
  });

  it('Cri de guerre : +20 % de Force pendant 2 manches', () => {
    const state = start('warrior', [
      { position: 0, skillId: 'GUE-A01-NEU' },
      { position: 1, skillId: 'GUE-S03-NEU' },
    ]);
    const after = act(state, 'GUE-S03-NEU').state;
    const buff = after.heroes[0]!.modifiers.find((m) => m.key === 'GUE-S03');
    expect(buff).toMatchObject({ kind: 'buff', stats: { strength: 0.2 }, remaining: 2 });
  });

  it('Malédiction : la cible inflige −15 % de dégâts (cible obligatoire)', () => {
    const state = start('mage', [
      { position: 0, skillId: 'MAG-A01-NEU' },
      { position: 1, skillId: 'MAG-S04-NEU' },
    ]);
    expect(() => act(state, 'MAG-S04-NEU')).toThrow('INVALID_TARGET');
    const target = firstMonster(state);
    const after = act(state, 'MAG-S04-NEU', target.id).state;
    const curse = after.monsters.find((m) => m.id === target.id)!.modifiers[0];
    expect(curse).toMatchObject({ kind: 'debuff', damageDealt: -0.15 });
  });

  it('effet d’élément d’un soutien : Souffle de pierre ajoute +15 % d’Armure', () => {
    const state = start('warrior', [
      { position: 0, skillId: 'GUE-A01-NEU' },
      { position: 1, skillId: 'GUE-S05-TER' },
    ]);
    const after = act(state, 'GUE-S05-TER').state;
    expect(after.heroes[0]!.modifiers).toContainEqual(
      expect.objectContaining({ key: 'element:GUE-S05', stats: { armor: 0.15 } }),
    );
  });
});

describe('attaques, éléments et fusions', () => {
  /** Dégâts moyens d'une compétence sur 200 combats (même cible, mêmes stats). */
  const averageDamage = (skillId: string, fusionElement: ElementId | null = null) => {
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const state = start('mage', [{ position: 0, skillId, fusionElement }], { seed, level: 80 });
      const target = firstMonster(state);
      const events = act(state, skillId, target.id).events;
      total += events
        .filter((e): e is Extract<CombatEvent, { type: 'damage' }> => e.type === 'damage')
        .filter((e) => e.targetId === target.id && e.cause === 'attack')
        .reduce((sum, e) => sum + e.amount, 0);
    }
    return total / 200;
  };

  it('une fusion frappe ×1,10 (Singularité : +25 % en plus, sans avantage élémentaire)', () => {
    const plain = averageDamage('MAG-A01-NEU');
    const singularity = averageDamage('MAG-A01-NEU', 'neutral');
    expect(singularity / plain).toBeGreaterThan(1.1 * 1.25 * 0.9);
    expect(singularity / plain).toBeLessThan(1.1 * 1.25 * 1.1);
  });

  it('Exécution : +50 % de dégâts sur une cible à moins de 30 % de PV', () => {
    /** Dégâts totaux d'Exécution sur 100 combats, contre une cible à `hpShare` de ses PV. */
    const total = (hpShare: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const state = start('warrior', [{ position: 0, skillId: 'GUE-A07-NEU' }], { seed });
        const target = firstMonster(state);
        target.stats.maxHp = 1_000_000;
        target.hp = Math.round(1_000_000 * hpShare);
        for (const e of act(state, 'GUE-A07-NEU', target.id).events)
          if (e.type === 'damage' && e.targetId === target.id) sum += e.amount;
      }
      return sum;
    };
    expect(total(0.2) / total(0.9)).toBeGreaterThan(1.35);
  });

  it('Grand Gel : 2 piles de Froid par coup', () => {
    let checked = false;
    for (let seed = 1; seed <= 30 && !checked; seed++) {
      const state = start(
        'mage',
        [
          { position: 0, skillId: 'MAG-A01-GLA', fusionElement: 'ice' },
          { position: 1, skillId: 'MAG-A02-NEU' },
        ],
        { seed, level: 90 },
      );
      const target = firstMonster(state);
      target.stats.maxHp = target.hp = 10_000_000;
      target.stats.statusResistance = 0;
      const after = act(state, 'MAG-A01-GLA', target.id);
      if (!after.events.some((e) => e.type === 'damage' && e.targetId === target.id)) continue;
      const hit = after.state.monsters.find((m) => m.id === target.id)!;
      expect(hit.alterations.find((a) => a.id === 'froid')?.stacks).toBe(2);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('Persistance : les altérations infligées durent 1 manche de plus', () => {
    const deck: Deck = [
      { position: 0, skillId: 'MAG-A01-FEU' },
      { position: 3, skillId: 'MAG-P04' },
    ];
    let found = false;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      const state = start('mage', deck, { seed, level: 40 });
      const target = firstMonster(state);
      target.stats.maxHp = target.hp = 10_000_000;
      const after = act(state, 'MAG-A01-FEU', target.id).state;
      const burn = after.monsters
        .find((m) => m.id === target.id)!
        .alterations.find((a) => a.id === 'brulure');
      if (burn) {
        // Brûlure : 3 manches dans le bestiaire, +1 avec Persistance.
        expect(burn.remaining).toBe(4);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('Rayon arcanique : deux impacts, chacun à la moitié de la puissance', () => {
    const state = start('mage', [
      { position: 0, skillId: 'MAG-A04-NEU' },
      { position: 1, skillId: 'MAG-A01-NEU' },
    ]);
    const target = firstMonster(state);
    target.stats.maxHp = target.hp = 10_000_000;
    const events = act(state, 'MAG-A04-NEU', target.id).events;
    const strikes = events.filter(
      (e) => (e.type === 'damage' || e.type === 'miss') && e.targetId === target.id,
    );
    expect(strikes).toHaveLength(2);
  });
});

describe('passifs', () => {
  it('Soif de sang : le Guerrier récupère 5 % des dégâts infligés', () => {
    let healed = false;
    for (let seed = 1; seed <= 20 && !healed; seed++) {
      const state = start(
        'warrior',
        [
          { position: 0, skillId: 'GUE-A01-NEU' },
          { position: 3, skillId: 'GUE-P02' },
        ],
        { seed },
      );
      state.heroes[0]!.hp = 1;
      const events = act(state, 'GUE-A01-NEU', firstMonster(state).id).events;
      const damage = events.find((e) => e.type === 'damage' && e.targetId !== 'h0');
      const heal = events.find((e) => e.type === 'heal' && e.targetId === 'h0');
      if (damage && damage.type === 'damage' && heal && heal.type === 'heal') {
        expect(heal.amount).toBe(Math.round(damage.amount * 0.05));
        healed = true;
      }
    }
    expect(healed).toBe(true);
  });

  it('Pas léger : +5 % d’esquive ; Maître d’armes : +5 % de Pénétration', () => {
    const state = start('ranger', [
      { position: 0, skillId: 'TIR-A01-NEU' },
      { position: 3, skillId: 'TIR-P04' },
    ]);
    expect(state.heroes[0]!.stats.dodgeBonus).toBeCloseTo(0.05);
    const warrior = start('warrior', [
      { position: 0, skillId: 'GUE-A01-NEU' },
      { position: 3, skillId: 'GUE-P07' },
    ]).heroes[0]!;
    const bare = start('warrior', [{ position: 0, skillId: 'GUE-A01-NEU' }]).heroes[0]!;
    expect(warrior.stats.penetration - bare.stats.penetration).toBeCloseTo(0.05);
  });

  it('Riposte : renvoie 30 % des dégâts physiques subis', () => {
    const state = start('warrior', [
      { position: 0, skillId: 'GUE-A01-NEU' },
      { position: 1, skillId: 'GUE-S06-NEU' },
    ]);
    const after = act(state, 'GUE-S06-NEU').state;
    expect(after.heroes[0]!.modifiers).toContainEqual(
      expect.objectContaining({ key: 'GUE-S06', reflect: 0.3 }),
    );
  });
});

describe('effets temporaires et altérations', () => {
  it('Affinité corrosive : la Corrosion monte jusqu’à 5 piles (options), 4 sinon', () => {
    const state = start('mage', [{ position: 0, skillId: 'MAG-A01-NEU' }]);
    const target = firstMonster(state);
    const events: CombatEvent[] = [];
    for (let i = 0; i < 6; i++)
      applyAlteration(data, state.heroes[0]!, target, 'corrosion', events);
    expect(target.alterations.find((a) => a.id === 'corrosion')!.stacks).toBe(4);
    for (let i = 0; i < 6; i++)
      applyAlteration(data, state.heroes[0]!, target, 'corrosion', events, { maxStacks: 5 });
    expect(target.alterations.find((a) => a.id === 'corrosion')!.stacks).toBe(5);
  });

  it('un bonus de dégâts multiplie les dégâts d’une attaque', () => {
    const base = start('warrior', [{ position: 0, skillId: 'GUE-A01-NEU' }]);
    const spec = {
      power: 1,
      element: 'neutral' as const,
      elementalShare: 0,
      armorIgnore: 0,
      resistanceIgnore: 0,
      neverMiss: true,
      bonusCrit: -1,
    };
    let plain = 0;
    let boosted = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const s1 = start('warrior', [{ position: 0, skillId: 'GUE-A01-NEU' }], { seed });
      const s2 = start('warrior', [{ position: 0, skillId: 'GUE-A01-NEU' }], { seed });
      plain += attack(data, s1.rng, s1.heroes[0]!, firstMonster(s1), spec, []).amount;
      boosted += attack(
        data,
        s2.rng,
        s2.heroes[0]!,
        firstMonster(s2),
        { ...spec, damageBonus: 0.5 },
        [],
      ).amount;
    }
    expect(base.phase).toBe('heroes');
    expect(boosted / plain).toBeCloseTo(1.5, 1);
  });

  it('un combat enregistré avant la phase 7 reprend sans erreur', () => {
    const state = start('warrior', [{ position: 0, skillId: 'GUE-A01-NEU' }]);
    const old = structuredClone(state) as unknown as Record<string, unknown>;
    delete old.alchemyLevel;
    for (const c of [...state.heroes, ...state.monsters]) {
      const raw = old[c.side === 'hero' ? 'heroes' : 'monsters'] as Record<string, unknown>[];
      const copy = raw.find((x) => x.id === c.id)!;
      delete copy.modifiers;
      delete copy.counters;
      delete copy.shieldRemaining;
      delete copy.extraSkips;
    }
    const restored = normalizeCombatState(old as unknown as CombatState);
    expect(restored.heroes[0]!.modifiers).toEqual([]);
    expect(() => act(restored, 'GUE-A01-NEU', firstMonster(restored).id)).not.toThrow();
  });
});
