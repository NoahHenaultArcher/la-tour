/**
 * Contrôles de cohérence entre domaines (références croisées, invariants de structure).
 * Chaque problème est collecté ; l'import échoue s'il y en a au moins un.
 */
import { CLASS_IDS, ELEMENT_IDS, RARITY_IDS, SLOT_IDS } from '@la-tour/shared';
import type {
  ElementsData,
  EquipmentData,
  FixturesData,
  FloorsData,
  LootData,
  MonstersData,
  ResourcesData,
  RewardsData,
  ShopData,
  SkillsData,
  StatsData,
  VillageData,
  ZonesData,
} from '@la-tour/shared/schemas';
import { slugify } from './labels.ts';

export interface ImportedData {
  stats: StatsData;
  elements: ElementsData;
  resources: ResourcesData;
  equipment: EquipmentData;
  skills: SkillsData;
  monsters: MonstersData;
  zones: ZonesData;
  floors: FloorsData;
  rewards: RewardsData;
  loot: LootData;
  shop: ShopData;
  village: VillageData;
  fixtures: FixturesData;
}

export function checkConsistency(data: ImportedData): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);

  const resourceIds = new Set(data.resources.resources.map((r) => r.id));
  const checkResource = (id: string, where: string) => {
    if (!resourceIds.has(id)) fail(`${where} : ressource « ${id} » inconnue.`);
  };
  const buildingIds = new Set(data.village.buildings.map((b) => b.id));

  // --- Ressources ---
  for (const r of data.resources.resources) {
    if (!buildingIds.has(r.source))
      fail(`Ressource « ${r.id} » : provenance « ${r.source} » n'est pas un bâtiment.`);
  }
  for (const family of data.equipment.materialFamilies) {
    family.tiers.forEach((id) => checkResource(id, `Famille de matériaux « ${family.name} »`));
  }
  for (const p of data.village.production)
    checkResource(p.resourceId, `Production de ${p.buildingId}`);
  for (const u of data.village.upgrades)
    checkResource(u.material, `Amélioration ${u.buildingId} niv. ${u.targetLevel}`);
  for (const b of data.village.params.levelBrackets)
    checkResource(b.material, 'Tranches de niveau du village');
  for (const b of data.village.upgradeTower.branches)
    checkResource(b.resourceId, `Tour d'amélioration, branche ${b.id}`);
  for (const s of data.shop.resources) checkResource(s.resourceId, 'Boutique');
  if (!resourceIds.has('charbon'))
    fail('La ressource « charbon » est absente (matériau de construction).');
  if (!resourceIds.has('ether')) fail("La ressource « éther » est absente (Tour d'amélioration).");

  // --- Équipements ---
  const { catalog, tiers, profiles, uniques, rarities } = data.equipment;
  const expectedItems =
    CLASS_IDS.length * SLOT_IDS.length * (tiers.length * (RARITY_IDS.length - 1) + 1);
  if (catalog.length !== expectedItems) {
    fail(
      `Catalogue des équipements : ${catalog.length} objets au lieu de ${expectedItems} (classes × slots × (paliers × raretés + 1 Unique)).`,
    );
  }
  if (new Set(catalog.map((c) => c.id)).size !== catalog.length)
    fail('Catalogue des équipements : identifiants en double.');
  if (profiles.length !== CLASS_IDS.length * SLOT_IDS.length)
    fail(`Profils : ${profiles.length} au lieu de 30.`);
  if (uniques.length !== CLASS_IDS.length * SLOT_IDS.length)
    fail(`Uniques : ${uniques.length} au lieu de 30.`);
  if (rarities.length !== RARITY_IDS.length) fail('Raretés : liste incomplète.');
  for (const item of catalog) {
    const where = `Équipement ${item.id}`;
    checkResource(item.upgradeResourceAtZero, where);
    if (item.material !== null) checkResource(item.material, where);
    if (!profiles.some((p) => p.classId === item.classId && p.slot === item.slot))
      fail(`${where} : profil absent.`);
    if (item.rarity === 'unique') {
      const unique = uniques.find((u) => u.id === item.id);
      if (!unique) fail(`${where} : absent de l'onglet Uniques.`);
      else if (unique.element !== item.element || unique.name !== item.name)
        fail(`${where} : nom ou élément différent de l'onglet Uniques.`);
    } else {
      const tier = tiers.find((t) => t.tier === item.tier);
      if (!tier) fail(`${where} : palier ${item.tier} inconnu.`);
      else if (tier.baseLevel !== item.baseLevel || tier.maxUpgrade !== item.maxUpgrade)
        fail(`${where} : niveau de base ou amélioration max différent du palier.`);
    }
  }

  // --- Compétences ---
  const { bases, catalog: skillCatalog } = data.skills;
  const actives = bases.filter((b) => b.family !== 'passive').length;
  const passives = bases.length - actives;
  const expectedSkills = actives * ELEMENT_IDS.length + passives;
  if (skillCatalog.length !== expectedSkills) {
    fail(
      `Catalogue des compétences : ${skillCatalog.length} au lieu de ${expectedSkills} (actives × 10 éléments + passifs).`,
    );
  }
  if (new Set(skillCatalog.map((s) => s.id)).size !== skillCatalog.length)
    fail('Catalogue des compétences : identifiants en double.');
  const elementById = new Map(data.elements.elements.map((e) => [e.id, e]));
  for (const skill of skillCatalog) {
    const element = elementById.get(skill.element);
    const isClassPassive = skill.family === 'passive' && skill.classId !== null;
    const expectedFloor = isClassPassive ? 0 : (element?.unlockFloor ?? -1);
    if (skill.unlockFloor !== expectedFloor) {
      fail(
        `Compétence ${skill.id} : étage de déblocage ${skill.unlockFloor} au lieu de ${expectedFloor}.`,
      );
    }
  }
  const fusionKey = (f: { element1: string; element2: string }) => `${f.element1}|${f.element2}`;
  const elementFusions = new Map(data.elements.fusions.map((f) => [fusionKey(f), f.name]));
  if (data.skills.fusions.length !== elementFusions.size) {
    fail(
      `Fusions : ${data.skills.fusions.length} dans Compétences, ${elementFusions.size} dans Éléments/Fusions.`,
    );
  }
  for (const fusion of data.skills.fusions) {
    const name = elementFusions.get(fusionKey(fusion));
    if (name !== fusion.name)
      fail(
        `Fusion ${fusionKey(fusion)} : « ${fusion.name} » dans Compétences, « ${name ?? 'absente'} » dans Éléments/Fusions.`,
      );
  }
  for (const kit of data.skills.starterKits) {
    for (const name of [kit.active1, kit.active2, kit.passive]) {
      const base = bases.find((b) => b.name === name && b.classId === kit.classId);
      if (!base) fail(`Kit de départ ${kit.classId} : compétence « ${name} » absente de Bases.`);
      else if (base.requiredLevel !== data.skills.params.noCooldownLevel)
        fail(`Kit de départ ${kit.classId} : « ${name} » n'est pas au niveau 1.`);
    }
  }

  // --- Monstres, zones, étages ---
  const zoneByFloor = new Map(data.zones.zones.map((z) => [z.floor, z]));
  const alterationIds = new Set(data.monsters.alterations.map((a) => a.id));
  for (const element of data.elements.elements) {
    for (const name of element.inflictedAlterations) {
      if (!alterationIds.has(slugify(name))) {
        fail(`Élément ${element.id} : altération « ${name} » absente de l'onglet Altérations.`);
      }
    }
  }
  for (const monster of data.monsters.monsters) {
    const zone = zoneByFloor.get(monster.zoneFloor);
    if (!zone) fail(`Monstre ${monster.id} : zone de l'étage ${monster.zoneFloor} inconnue.`);
    if (monster.atZoneLevel.level !== monster.zoneFloor)
      fail(
        `Monstre ${monster.id} : niveau ${monster.atZoneLevel.level} au lieu de ${monster.zoneFloor}.`,
      );
  }
  for (const zone of data.zones.zones) {
    const members = data.monsters.monsters.filter((m) => m.zoneFloor === zone.floor);
    const bosses = members.filter((m) => m.rank === 'boss' || m.rank === 'dragon');
    if (bosses.length !== 1 || bosses[0]!.name !== zone.bossName) {
      fail(
        `Zone ${zone.floor} (${zone.name}) : le boss « ${zone.bossName} » doit être l'unique boss/dragon de la zone.`,
      );
    }
    if (members.length - bosses.length !== zone.huntingMonsterCount) {
      fail(
        `Zone ${zone.floor} : ${members.length - bosses.length} monstres hors boss, ${zone.huntingMonsterCount} annoncés.`,
      );
    }
    const biome = data.elements.biomes.find((b) => b.id === zone.biome);
    if (
      !biome ||
      zone.floor < biome.floorMin ||
      zone.floor > biome.floorMax ||
      biome.element !== zone.element
    ) {
      fail(`Zone ${zone.floor} : biome ou élément incohérent avec les étages du biome.`);
    }
  }
  data.floors.floors.forEach((floor, index) => {
    if (floor.floor !== index + 1)
      fail(`Étages : l'étage n° ${index + 1} manque ou est en double.`);
    const zone = zoneByFloor.get(floor.zoneFloor);
    if (!zone || zone.name !== floor.zoneName)
      fail(`Étage ${floor.floor} : zone « ${floor.zoneName} » inconnue.`);
  });
  if (data.floors.floors.length !== 100)
    fail(`Étages : ${data.floors.floors.length} au lieu de 100.`);

  // --- Récompenses ---
  data.rewards.levels.forEach((level, index) => {
    if (level.level !== index + 1) fail(`Récompenses : le niveau ${index + 1} manque.`);
  });

  // --- Butin ---
  for (const entry of data.loot.uniquesByBiome) {
    for (const classId of CLASS_IDS) {
      const unique = uniques.find(
        (u) => u.classId === classId && u.name === entry.uniques[classId],
      );
      if (!unique)
        fail(
          `Butin › Uniques (${entry.biome}) : « ${entry.uniques[classId]} » absent de l'onglet Uniques.`,
        );
      else if (unique.biome !== entry.biome)
        fail(`Unique « ${unique.name} » : biome ${unique.biome} au lieu de ${entry.biome}.`);
    }
  }

  // --- Village ---
  for (const p of data.village.production) {
    if (!buildingIds.has(p.buildingId)) fail(`Production : bâtiment « ${p.buildingId} » inconnu.`);
  }

  // --- Cas de test ---
  if (!catalog.some((c) => c.id === data.fixtures.equipmentProgression.itemId))
    fail('Cas de test : objet de la Progression introuvable.');

  return problems;
}
