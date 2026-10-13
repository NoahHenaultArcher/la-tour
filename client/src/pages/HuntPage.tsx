import { RARITY_IDS, tierForFloor, unlockedHuntingZones } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { MonsterTooltip } from '../components/combat/CombatantCard.tsx';
import { ElementBadge } from '../components/ElementBadge.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { elementStyle } from '../game/elements.ts';
import { rarityInfo } from '../game/items.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { useCombat } from '../stores/combat.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

type Zone = (typeof gameData.zones.zones)[number];

const percent = (value: number) =>
  `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

/** Butin possible d'une zone : palier du matériau, raretés et chances par rang de monstre. */
function ZoneLoot({ zone }: { zone: Zone }) {
  const table = gameData.loot.rarityTables.monsters.find((r) => r.biome === zone.biome);
  const ranks = new Set(
    gameData.monsters.monsters
      .filter((m) => m.zoneFloor === zone.floor && m.rank !== 'boss' && m.rank !== 'dragon')
      .map((m) => m.rank),
  );
  const drops = gameData.loot.dropByRank.filter((d) => ranks.has(d.rank));
  return (
    <div className="zone-loot">
      <span>
        {t('workshop.tier', { tier: tierForFloor(gameData.equipment, zone.floor) })} ·{' '}
        {t('hunt.dropChance', {
          chances: drops
            .map(
              (d) =>
                `${gameData.monsters.ranks.find((r) => r.id === d.rank)?.name ?? d.rank} ${percent(d.dropChance)}`,
            )
            .join(', '),
        })}
      </span>
      <span className="zone-rarities">
        {RARITY_IDS.filter((r) => (table?.weights[r] ?? 0) > 0).map((r) => (
          <span key={r} style={{ color: rarityInfo(r).color }}>
            {rarityInfo(r).name} {percent(table!.weights[r])}
          </span>
        ))}
      </span>
      <span className="muted">{t('hunt.noUnique')}</span>
    </div>
  );
}

function ZoneCard({
  zone,
  unlocked,
  disabled,
  onHunt,
}: {
  zone: Zone;
  unlocked: boolean;
  disabled: boolean;
  onHunt: () => void;
}) {
  const monsters = gameData.monsters.monsters.filter(
    (m) => m.zoneFloor === zone.floor && m.rank !== 'boss' && m.rank !== 'dragon',
  );
  const levels = t('hunt.levels', { min: zone.huntingLevelMin!, max: zone.huntingLevelMax! });
  const estimates = zone.estimates;
  return (
    <article
      className={`zone-card panel element-themed${unlocked ? '' : ' locked'}`}
      style={elementStyle(zone.element)}
    >
      <header>
        <h2>{zone.name}</h2>
        <span className="muted">
          {levels} · {t('tower.element')} : <ElementBadge element={zone.element} />
        </span>
      </header>
      {unlocked ? (
        <>
          <ul className="zone-monsters">
            {monsters.map((m) => (
              <Tooltip
                key={m.id}
                content={
                  <MonsterTooltip monsterId={m.id} element={zone.element} levelText={levels} />
                }
              >
                <li tabIndex={0}>
                  <PixelImage src={m.image} alt={m.name} size={48} />
                  <span>{m.name}</span>
                </li>
              </Tooltip>
            ))}
          </ul>
          <ZoneLoot zone={zone} />
          {estimates.xpPerHour !== null && (
            <p className="muted zone-estimates">
              {t('hunt.estimates', {
                xp: formatNumber(Math.round(estimates.xpPerHour)),
                gold: formatNumber(Math.round(estimates.goldPerHour ?? 0)),
                items: formatNumber(Math.round(estimates.itemsPerHour ?? 0)),
              })}
            </p>
          )}
          <button type="button" className="primary" aria-disabled={disabled} onClick={onHunt}>
            {t('hunt.start')}
          </button>
        </>
      ) : (
        <p className="muted">{t('hunt.locked', { floor: zone.floor, boss: zone.bossName })}</p>
      )}
    </article>
  );
}

/** Zones de chasse : débloquées par les boss, on y affronte les monstres de la zone à l'infini. */
export function HuntPage() {
  const save = useSession((s) => s.save)!;
  const navigate = useNavigate();
  const startHunt = useCombat((s) => s.startHunt);
  const load = useCombat((s) => s.load);
  const inProgress = useCombat((s) => s.target);
  const busy = useCombat((s) => s.busy);
  const notify = useNotifications((s) => s.notify);

  useEffect(() => {
    void load();
  }, [load]);

  const unlocked = new Set(
    unlockedHuntingZones(gameData.zones, save.highestFloorCleared).map((z) => z.floor),
  );
  // Zones débloquées, plus la prochaine à débloquer (grisée).
  const allZones = gameData.zones.zones.filter((z) => z.hasHuntingZone);
  const nextLocked = allZones.find((z) => !unlocked.has(z.floor));
  const zones = allZones.filter((z) => unlocked.has(z.floor) || z === nextLocked).reverse();
  const fighting = inProgress?.phase === 'heroes';

  const hunt = async (zoneFloor: number) => {
    if (busy || fighting) return;
    await startHunt(zoneFloor);
    const { error } = useCombat.getState();
    if (error) notify('error', error);
    else navigate('/combat');
  };

  return (
    <div className="page">
      <TopBar />
      <main className="hunt-page">
        <header className="tower-header">
          <h1>{t('hunt.title')}</h1>
          <p className="muted">{t('hunt.intro')}</p>
          {fighting && (
            <button type="button" className="primary" onClick={() => navigate('/combat')}>
              {t('combat.resume')}
            </button>
          )}
        </header>
        {unlocked.size === 0 && <p className="warning">{t('hunt.none')}</p>}
        <div className="zone-list">
          {zones.map((zone) => (
            <ZoneCard
              key={zone.floor}
              zone={zone}
              unlocked={unlocked.has(zone.floor)}
              disabled={busy || fighting}
              onHunt={() => void hunt(zone.floor)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
