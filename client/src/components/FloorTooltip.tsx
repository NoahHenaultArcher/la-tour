import { uniqueForBossFloor } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { rarityInfo } from '../game/items.ts';
import { t } from '../i18n/index.ts';
import { ElementBadge } from './ElementBadge.tsx';

export type FloorInfo = (typeof gameData.floors.floors)[number];

/** Infobulle d'un étage de la tour : zone, type, niveau, élément, monstres, boss, zone débloquée. */
export function FloorTooltip({ floor }: { floor: FloorInfo }) {
  const monsters = gameData.monsters.monsters.filter(
    (m) =>
      m.zoneFloor === floor.zoneFloor &&
      (floor.type !== 'normal' || (m.rank !== 'boss' && m.rank !== 'dragon')),
  );
  const unique = floor.type === 'normal' ? null : uniqueForBossFloor(gameData, floor.floor);
  return (
    <div className="tooltip-body">
      <strong>{t('tower.floor', { floor: floor.floor })}</strong>
      <span>
        {floor.zoneName} · {t(`tower.type.${floor.type}`)}
      </span>
      <span>{t('tower.monsterLevel', { level: floor.monsterLevel })}</span>
      <span>
        {t('tower.element')} : <ElementBadge element={floor.element} />
      </span>
      <span>
        {t('tower.waves', { waves: floor.waves })} ·{' '}
        {monsters
          .filter((m) => m.rank !== 'boss' && m.rank !== 'dragon')
          .map((m) => m.name)
          .join(', ')}
      </span>
      {floor.bossName && (
        <span className="boss-name">{t('tower.boss', { name: floor.bossName })}</span>
      )}
      {unique && (
        <span>
          {t('tower.unique')} :{' '}
          <strong style={{ color: rarityInfo('unique').color }}>{unique.name}</strong> (
          {t(`class.name.${unique.classId}`)})
        </span>
      )}
      {floor.unlocksHuntingZone && (
        <span className="muted">{t('tower.unlocksZone', { zone: floor.unlocksHuntingZone })}</span>
      )}
    </div>
  );
}
