import {
  CLASS_IDS,
  MAX_HERO_LEVEL,
  RELICS,
  SLOT_IDS,
  TOWER_FLOORS,
  XP_GAIN,
  byId,
  canAfford,
  canInherit,
  abyssFloorType,
  isAbyssUnlocked,
  classAttackStat,
  excelRound,
  itemPower,
  nextBuildingUpgrade,
  tavernOffers,
  unlockedHuntingZones,
  upgradeShortfall,
  type CharacterDto,
  type SaveDto,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { MonsterTooltip } from '../components/combat/CombatantCard.tsx';
import { SkillTooltip } from '../components/combat/SkillBar.tsx';
import { ElementBadge } from '../components/ElementBadge.tsx';
import { FloorTooltip } from '../components/FloorTooltip.tsx';
import { ItemIcon } from '../components/items/ItemIcon.tsx';
import { ItemTooltip } from '../components/items/ItemTooltip.tsx';
import { RelicIcon, RelicTooltip } from '../components/relics/RelicIcon.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CLASS_IMAGES } from '../game/assets.ts';
import { elementName, elementStyle } from '../game/elements.ts';
import { catalogItem, characterStats, equippedIn, statsOf } from '../game/items.ts';
import { relicSlots } from '../game/relics.ts';
import { resourceById, useVillageView, type VillageView } from '../game/village.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { useCombat } from '../stores/combat.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

type Zone = (typeof gameData.zones.zones)[number];

/** Monstres d'une zone hors boss et dragon. */
const regularsOf = (zoneFloor: number) =>
  gameData.monsters.monsters.filter(
    (m) => m.zoneFloor === zoneFloor && m.rank !== 'boss' && m.rank !== 'dragon',
  );

function ProgressBar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 1;
  return (
    <span className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}

function Card({
  title,
  link,
  className = '',
  style,
  children,
}: {
  title: string;
  link?: { to: string; label: string };
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className={`panel home-card ${className}`} style={style}>
      <header className="home-card-header">
        <h2>{title}</h2>
        {link && <Link to={link.to}>{link.label} →</Link>}
      </header>
      {children}
    </section>
  );
}

/** Lance un combat (étage ou zone de chasse) puis ouvre la page de combat. */
function useLaunch() {
  const navigate = useNavigate();
  const notify = useNotifications((s) => s.notify);
  return async (launch: () => Promise<void>) => {
    await launch();
    const { error } = useCombat.getState();
    if (error) notify('error', error);
    else navigate('/combat');
  };
}

/** Frise des 10 biomes : part des étages terminés, infobulle par biome. */
function BiomeStrip({ cleared }: { cleared: number }) {
  return (
    <div className="biome-strip">
      {gameData.elements.biomes.map((biome) => {
        const total = biome.floorMax - biome.floorMin + 1;
        const done = Math.min(total, Math.max(0, cleared - biome.floorMin + 1));
        const element = gameData.elements.elements.find((e) => e.id === biome.element);
        return (
          <Tooltip
            key={biome.id}
            content={
              <div className="tooltip-body">
                <strong>{biome.name}</strong>
                <span>{t('tower.floors', { min: biome.floorMin, max: biome.floorMax })}</span>
                <span>
                  {t('tower.element')} : <ElementBadge element={biome.element} />
                </span>
                <span>{t('home.biomeCleared', { done, total })}</span>
                {element && element.unlockFloor > 0 && (
                  <span className={done === total ? 'ok' : 'muted'}>
                    {t(done === total ? 'home.elementUnlocked' : 'home.elementUnlockAt', {
                      element: element.name,
                      floor: element.unlockFloor,
                    })}
                  </span>
                )}
              </div>
            }
          >
            <Link
              to="/tour"
              className="biome-segment"
              style={elementStyle(biome.element)}
              aria-label={biome.name}
            >
              <span style={{ width: `${(done / total) * 100}%` }} />
            </Link>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Prochain défi de la tour : étage courant, écart de niveau, lancement direct. */
function TowerCard({ save }: { save: SaveDto }) {
  const start = useCombat((s) => s.start);
  const startAbyss = useCombat((s) => s.startAbyss);
  const inProgress = useCombat((s) => s.target);
  const busy = useCombat((s) => s.busy);
  const launch = useLaunch();
  const finished = save.highestFloorCleared >= TOWER_FLOORS;
  const floor = gameData.floors.floors.find((f) => f.floor === save.currentFloor)!;
  const fighting = inProgress?.phase === 'heroes';
  const teamLevel = Math.round(
    save.characters.reduce((sum, c) => sum + c.level, 0) / save.characters.length,
  );
  const gap = floor.monsterLevel - teamLevel;
  const boss = floor.bossName
    ? gameData.monsters.monsters.find(
        (m) => m.zoneFloor === floor.zoneFloor && (m.rank === 'boss' || m.rank === 'dragon'),
      )
    : undefined;
  const shown = boss ? [boss] : regularsOf(floor.zoneFloor);

  return (
    <Card
      title={t('home.towerTitle')}
      link={{ to: '/tour', label: t('home.seeTower') }}
      className="element-themed home-tower"
      style={elementStyle(floor.element)}
    >
      <div className="home-tower-body">
        {finished ? (
          <div className="home-abyss">
            <p className="ok">{t('home.towerDone')}</p>
            <p>
              {t('home.abyssLine', {
                floor: save.abyssFloor,
                type: t(`abyss.type.${abyssFloorType(save.abyssFloor)}`),
                record: save.bestAbyssFloor,
              })}
            </p>
            <Link to="/abysse">{t('home.seeAbyss')} →</Link>
          </div>
        ) : (
          <>
            <Tooltip content={<FloorTooltip floor={floor} />}>
              <div className="home-floor" tabIndex={0}>
                <span className="home-floor-number">{floor.floor}</span>
                <div>
                  <strong>{floor.zoneName}</strong>
                  <div className="muted">
                    {t(`tower.type.${floor.type}`)} · {t('tower.waves', { waves: floor.waves })} ·{' '}
                    <ElementBadge element={floor.element} />
                  </div>
                  <div>{t('tower.monsterLevel', { level: floor.monsterLevel })}</div>
                </div>
              </div>
            </Tooltip>
            <ul className="home-monsters">
              {shown.map((m) => (
                <Tooltip
                  key={m.id}
                  content={
                    <MonsterTooltip
                      monsterId={m.id}
                      element={floor.element}
                      levelText={t('home.levelShort', { level: floor.monsterLevel })}
                    />
                  }
                >
                  <li tabIndex={0}>
                    <PixelImage src={m.image} alt={m.name} size={boss ? 72 : 40} />
                  </li>
                </Tooltip>
              ))}
            </ul>
            <p className={gap > 5 ? 'error' : gap > 0 ? 'warn-text' : 'ok'}>
              {gap > 5
                ? t('home.gapHigh', { gap, level: teamLevel })
                : gap > 0
                  ? t('home.gapSmall', { gap, level: teamLevel })
                  : t('home.gapOk', { level: teamLevel })}
            </p>
          </>
        )}
        <div className="home-actions">
          {fighting ? (
            <Link to="/combat" className="button primary">
              {t('combat.resume')}
            </Link>
          ) : finished ? (
            <button
              type="button"
              className="primary"
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void launch(startAbyss);
              }}
            >
              {t('abyss.descend', { floor: save.abyssFloor })}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void launch(() => start(floor.floor));
              }}
            >
              {t('home.fightFloor', { floor: floor.floor })}
            </button>
          )}
        </div>
      </div>
      <BiomeStrip cleared={save.highestFloorCleared} />
      <p className="muted small">
        {t('home.towerStats', {
          cleared: save.highestFloorCleared,
          best: save.bestFloorEver,
          heritage: save.heritageCount,
        })}
      </p>
    </Card>
  );
}

/** Meilleure zone de chasse ouverte et prochaine zone à débloquer. */
function HuntCard({ save }: { save: SaveDto }) {
  const startHunt = useCombat((s) => s.startHunt);
  const inProgress = useCombat((s) => s.target);
  const busy = useCombat((s) => s.busy);
  const launch = useLaunch();
  const all = gameData.zones.zones.filter((z) => z.hasHuntingZone);
  const unlocked = unlockedHuntingZones(gameData.zones, save.highestFloorCleared);
  const best = unlocked.reduce<Zone | null>((a, z) => (!a || z.floor > a.floor ? z : a), null);
  const next = all.find((z) => z.floor > save.highestFloorCleared);
  const fighting = inProgress?.phase === 'heroes';

  return (
    <Card title={t('home.huntTitle')} link={{ to: '/chasse', label: t('home.seeHunts') }}>
      <p className="muted small">
        {t('home.zonesUnlocked', { count: unlocked.length, total: all.length })}
      </p>
      {best ? (
        <div className="home-zone element-themed" style={elementStyle(best.element)}>
          <strong>{best.name}</strong>
          <span className="muted">
            {t('hunt.levels', { min: best.huntingLevelMin!, max: best.huntingLevelMax! })} ·{' '}
            <ElementBadge element={best.element} />
          </span>
          <ul className="home-monsters">
            {regularsOf(best.floor).map((m) => (
              <Tooltip
                key={m.id}
                content={
                  <MonsterTooltip
                    monsterId={m.id}
                    element={best.element}
                    levelText={t('hunt.levels', {
                      min: best.huntingLevelMin!,
                      max: best.huntingLevelMax!,
                    })}
                  />
                }
              >
                <li tabIndex={0}>
                  <PixelImage src={m.image} alt={m.name} size={40} />
                </li>
              </Tooltip>
            ))}
          </ul>
          {best.estimates.xpPerHour !== null && (
            <span className="small">
              {t('home.huntEstimates', {
                xp: formatNumber(Math.round(best.estimates.xpPerHour * XP_GAIN.multiplier)),
                gold: formatNumber(Math.round(best.estimates.goldPerHour ?? 0)),
              })}
            </span>
          )}
          <div className="home-actions">
            <button
              type="button"
              className="primary"
              aria-disabled={busy || fighting}
              onClick={() => {
                if (!busy && !fighting) void launch(() => startHunt(best.floor));
              }}
            >
              {t('home.huntHere')}
            </button>
          </div>
        </div>
      ) : (
        <p className="warning">{t('hunt.none')}</p>
      )}
      {next && (
        <p className="muted small">
          {t('home.nextZone', {
            zone: next.name,
            floor: next.floor,
            boss: next.bossName,
            left: next.floor - save.highestFloorCleared,
          })}
        </p>
      )}
    </Card>
  );
}

/** Nombre d'objets de l'inventaire plus puissants que celui porté au même emplacement. */
function betterItemsCount(save: SaveDto, character: CharacterDto): number {
  const power = (item: Parameters<typeof statsOf>[0]) =>
    itemPower(gameData.equipment, statsOf(item));
  return save.items.filter((item) => {
    if (item.equippedBy) return false;
    const info = catalogItem(item.catalogId);
    if (info.classId !== character.classId) return false;
    // Les anneaux vont dans l'un ou l'autre emplacement : on compare au plus faible des deux.
    const slots = info.slot === 'ring1' || info.slot === 'ring2' ? ['ring1', 'ring2'] : [info.slot];
    const worst = Math.min(
      ...slots.map((slot) => {
        const equipped = equippedIn(save, character.id, slot);
        return equipped ? power(equipped) : 0;
      }),
    );
    return power(item) > worst;
  }).length;
}

function HeroSummary({
  save,
  character,
  view,
}: {
  save: SaveDto;
  character: CharacterDto;
  view: VillageView;
}) {
  const stats = characterStats(save, character);
  const attack = classAttackStat(character.classId);
  const better = betterItemsCount(save, character);
  const empty = SLOT_IDS.filter((slot) => !equippedIn(save, character.id, slot)).length;
  const deck = [...character.skills].sort((a, b) => a.position - b.position);

  return (
    <article className="home-hero">
      <div className="home-hero-identity">
        <PixelImage src={CLASS_IMAGES[character.classId]} alt="" size={64} />
        <div className="home-hero-text">
          <strong>{t(`class.name.${character.classId}`)}</strong>
          <span>{t('home.level', { level: character.level })}</span>
          {character.xpToNextLevel === null ? (
            <span className="muted small">{t('home.xpMax')}</span>
          ) : (
            <Tooltip
              content={t('home.xp', {
                xp: formatNumber(character.xp),
                next: formatNumber(character.xpToNextLevel),
              })}
            >
              <span tabIndex={0}>
                <ProgressBar value={character.xp} max={character.xpToNextLevel} />
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <dl className="home-hero-stats">
        <div>
          <dt>{t('team.stat.hp')}</dt>
          <dd>{formatNumber(Math.round(stats.maxHp))}</dd>
        </div>
        <div>
          <dt>{t(`team.stat.${attack}`)}</dt>
          <dd>{formatNumber(Math.round(stats[attack]))}</dd>
        </div>
        <div>
          <dt>{t('team.stat.initiative')}</dt>
          <dd>{formatNumber(Math.round(stats.initiative))}</dd>
        </div>
      </dl>
      <div className="home-equipment">
        {SLOT_IDS.map((slot) => {
          const item = equippedIn(save, character.id, slot);
          return item ? (
            <Tooltip
              key={slot}
              content={<ItemTooltip item={item} save={save} resources={view.resources} />}
            >
              <span tabIndex={0}>
                <ItemIcon catalogId={item.catalogId} upgradeLevel={item.upgradeLevel} scale={2} />
              </span>
            </Tooltip>
          ) : (
            <Tooltip key={slot} content={t('home.emptySlot', { slot: t(`slot.${slot}`) })}>
              <span className="home-slot-empty" tabIndex={0} />
            </Tooltip>
          );
        })}
      </div>
      <div className="home-deck">
        {deck.map((slot) => {
          const skill = byId(gameData.skills.catalog, slot.skillId);
          if (!skill) return null;
          return (
            <Tooltip
              key={slot.position}
              content={<SkillTooltip skill={skill} fusion={slot.fusionElement} />}
            >
              <span tabIndex={0} className={slot.position >= 3 ? 'home-passive' : ''}>
                <PixelImage src={skill.image} alt={skill.name} size={28} />
              </span>
            </Tooltip>
          );
        })}
      </div>
      <ul className="home-alerts">
        {character.statPoints.available > 0 && (
          <li className="warn-text">
            {t('home.pointsToSpend', { points: character.statPoints.available })}
          </li>
        )}
        {better > 0 && <li className="ok">{t('home.betterItems', { count: better })}</li>}
        {empty > 0 && <li className="muted">{t('home.emptySlots', { count: empty })}</li>}
      </ul>
    </article>
  );
}

/** Classes pas encore recrutées : prix à la taverne et progression de l'or. */
function RecruitHint({ save }: { save: SaveDto }) {
  const owned = save.characters.map((c) => c.classId);
  const missing = CLASS_IDS.filter((c) => !owned.includes(c));
  const offer = gameData.shop.characters.find((c) => c.purchaseNumber === owned.length + 1);
  if (missing.length === 0 || !offer) return null;
  const discount = tavernOffers(gameData.village, save.buildings.taverne ?? 1).discount;
  const price = excelRound(offer.price * (1 - discount));
  return (
    <article className="home-hero home-recruit">
      <div className="home-recruit-portraits">
        {missing.map((classId) => (
          <PixelImage key={classId} src={CLASS_IMAGES[classId]} alt="" size={48} />
        ))}
      </div>
      <strong>{t('home.recruitTitle')}</strong>
      <span className="small">
        {missing.map((c) => t(`class.name.${c}`)).join(' · ')} :{' '}
        {t('home.recruitPrice', { price: formatNumber(price) })}
      </span>
      <ProgressBar value={save.gold} max={price} />
      <span className={save.gold >= price ? 'ok small' : 'muted small'}>
        {save.gold >= price
          ? t('home.recruitReady')
          : t('home.recruitMissing', { gold: formatNumber(price - save.gold) })}
      </span>
      <Link to="/village">{t('home.toTavern')} →</Link>
    </article>
  );
}

/** Bâtiments améliorables, ressources bloquées par l'Entrepôt, meilleures productions. */
function VillageCard({ save, view }: { save: SaveDto; view: VillageView }) {
  const upgradable = gameData.village.buildings.filter((b) => {
    const level = save.buildings[b.id];
    if (level === undefined) return false;
    const next = nextBuildingUpgrade(gameData.village, b.id, level);
    return (
      next !== null &&
      canAfford(
        upgradeShortfall(next.cost, {
          gold: save.gold,
          resources: view.resources,
          floorCleared: save.bestFloorEver,
        }),
      )
    );
  });
  const full = Object.entries(view.resources)
    .filter(([id, amount]) => amount >= view.capacity && view.ratePerHour(id) > 0)
    .map(([id]) => resourceById(id)?.name ?? id);
  const production = gameData.resources.resources
    .map((r) => ({ resource: r, rate: view.ratePerHour(r.id) }))
    .filter((p) => p.rate > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);

  return (
    <Card title={t('home.villageTitle')} link={{ to: '/village', label: t('home.seeVillage') }}>
      {upgradable.length > 0 ? (
        <p className="ok">
          {t('home.upgradable', { buildings: upgradable.map((b) => b.name).join(', ') })}
        </p>
      ) : (
        <p className="muted small">{t('home.noUpgrade')}</p>
      )}
      {full.length > 0 && (
        <p className="warning">{t('home.warehouseFull', { resources: full.join(', ') })}</p>
      )}
      <ul className="home-production">
        {production.map(({ resource, rate }) => (
          <li key={resource.id}>
            <PixelImage src={resource.image} alt="" size={20} />
            <span className="capitalize">{resource.name}</span>
            <span className="muted">{t('resource.perHour', { rate: formatNumber(rate) })}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">{t('home.offline', { hours: view.maxHours })}</p>
    </Card>
  );
}

/** Reliques et œufs équipés (6 emplacements), avec leurs effets au survol. */
function RelicsCard({ save }: { save: SaveDto }) {
  const slots = relicSlots(save);
  const owned = save.relics.length;
  return (
    <Card title={t('relic.homeTitle')} link={{ to: '/equipe', label: t('relic.manage') }}>
      <div className="home-relics">
        {slots.map((relicId, slot) =>
          relicId ? (
            <Tooltip key={slot} content={<RelicTooltip relicId={relicId} save={save} />}>
              <span tabIndex={0}>
                <RelicIcon relicId={relicId} />
              </span>
            </Tooltip>
          ) : (
            <Tooltip key={slot} content={t('relic.emptySlot', { slot: slot + 1 })}>
              <span className="relic-empty" tabIndex={0} />
            </Tooltip>
          ),
        )}
      </div>
      <p className="muted small">
        {owned === 0
          ? t('relic.homeNone')
          : t('relic.homeOwned', { count: owned, total: RELICS.length })}
      </p>
    </Card>
  );
}

interface Goal {
  floor: number;
  label: ReactNode;
}

/** Prochains déblocages liés à la tour, du plus proche au plus lointain. */
function GoalsCard({ save }: { save: SaveDto }) {
  const cleared = save.highestFloorCleared;
  const goals: Goal[] = [];
  const zone = gameData.zones.zones.find((z) => z.hasHuntingZone && z.floor > cleared);
  if (zone) goals.push({ floor: zone.floor, label: t('home.goalZone', { zone: zone.name }) });
  const element = gameData.elements.elements
    .filter((e) => e.unlockFloor > cleared)
    .sort((a, b) => a.unlockFloor - b.unlockFloor)[0];
  if (element)
    goals.push({
      floor: element.unlockFloor,
      label: (
        <>
          {t('home.goalElement')} <ElementBadge element={element.id} />
        </>
      ),
    });
  for (const building of gameData.village.buildings.filter(
    (b) => b.unlockFloor > cleared && save.buildings[b.id] === undefined,
  ))
    goals.push({
      floor: building.unlockFloor,
      label: t('home.goalBuilding', { building: building.name }),
    });
  const tier = gameData.equipment.tiers.find((tr) => tr.unlockFloor > cleared);
  if (tier) goals.push({ floor: tier.unlockFloor, label: t('home.goalTier', { tier: tier.tier }) });
  const dragon = gameData.floors.floors.find((f) => f.type === 'dragon' && f.floor > cleared);
  if (dragon)
    goals.push({
      floor: dragon.floor,
      label: t('home.goalDragon', { name: dragon.bossName ?? elementName(dragon.element) }),
    });
  if (!isAbyssUnlocked(cleared)) goals.push({ floor: TOWER_FLOORS, label: t('home.goalAbyss') });
  goals.sort((a, b) => a.floor - b.floor);

  const bestLevel = Math.max(...save.characters.map((c) => c.level));
  const heritageReady = canInherit(save.characters, MAX_HERO_LEVEL);

  return (
    <Card title={t('home.goalsTitle')}>
      <ul className="home-goals">
        {goals.slice(0, 5).map((goal, i) => (
          <li key={i}>
            <span className="home-goal-floor">{t('tower.floor', { floor: goal.floor })}</span>
            <span>{goal.label}</span>
            <span className="muted small">
              {t('home.floorsLeft', { left: goal.floor - cleared })}
            </span>
          </li>
        ))}
      </ul>
      {heritageReady ? (
        <Link to="/heritage" className="button primary">
          {t('home.heritageReady')}
        </Link>
      ) : (
        <div className="home-heritage">
          <span className="small">
            {t('home.heritageAt', { level: bestLevel, max: MAX_HERO_LEVEL })}
          </span>
          <ProgressBar value={bestLevel} max={MAX_HERO_LEVEL} />
        </div>
      )}
    </Card>
  );
}

/** Page d'accueil : un coup d'œil sur la tour, la chasse, l'équipe, le village et les objectifs. */
export function HomePage() {
  const save = useSession((s) => s.save)!;
  const user = useSession((s) => s.user)!;
  const load = useCombat((s) => s.load);
  const view = useVillageView();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <TopBar />
      <main className="home-page">
        <header className="home-welcome">
          <h1>{t('home.welcome', { name: user.username })}</h1>
          <p className="muted">
            {t('home.goldLine', { gold: formatNumber(save.gold), items: save.items.length })}
          </p>
        </header>
        <div className="home-grid">
          <TowerCard save={save} />
          <HuntCard save={save} />
          <Card
            title={t('home.team')}
            link={{ to: '/equipe', label: t('home.seeTeam') }}
            className="home-team"
          >
            <div className="home-heroes">
              {save.characters.map((character) => (
                <HeroSummary key={character.id} save={save} character={character} view={view} />
              ))}
              <RecruitHint save={save} />
            </div>
          </Card>
          <RelicsCard save={save} />
          <VillageCard save={save} view={view} />
          <GoalsCard save={save} />
        </div>
      </main>
    </div>
  );
}
