import {
  ALCHEMY,
  fusionCost,
  maxFusions,
  nextUpgradeTowerStep,
  upgradeTowerBonus,
  type UpgradeTowerBranchId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { resourceById, useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';
import { FusionBadge } from './ElementBadge.tsx';
import { PixelImage } from './PixelImage.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Tour d'alchimie : règles des fusions selon le niveau, et les 55 recettes. */
export function AlchemySection({ level }: { level: number }) {
  const navigate = useNavigate();
  const unlocked = useSession((s) => s.save?.unlockedElements ?? []);
  const cost = fusionCost(level);
  const fusions = gameData.skills.fusions;
  return (
    <section className="alchemy-section">
      <h3>{t('alchemy.title')}</h3>
      <p>{t('alchemy.intro')}</p>
      <ul className="outcome-rewards">
        <li>{t('alchemy.perHero', { count: maxFusions(level) })}</li>
        <li>
          {t('alchemy.cost', { ether: formatNumber(cost.ether), gold: formatNumber(cost.gold) })}
        </li>
        {level >= ALCHEMY.extraDurationLevel && <li>{t('alchemy.extraDuration')}</li>}
      </ul>
      <p className="muted small">{t('alchemy.levels')}</p>
      <div className="modal-actions">
        <button type="button" className="primary" onClick={() => navigate('/competences')}>
          {t('alchemy.toSkills')}
        </button>
      </div>
      <h3>{t('alchemy.recipes', { count: fusions.length })}</h3>
      <ul className="fusion-recipes">
        {fusions.map((f) => {
          const available = unlocked.includes(f.element1) && unlocked.includes(f.element2);
          return (
            <Tooltip
              key={f.name}
              content={
                <div className="tooltip-body">
                  <strong>{f.name}</strong>
                  <span>{f.combatEffect}</span>
                  <span className="muted">{f.role}</span>
                </div>
              }
            >
              <li tabIndex={0} className={available ? '' : 'locked'}>
                <FusionBadge a={f.element1} b={f.element2} name={f.name} />
              </li>
            </Tooltip>
          );
        })}
      </ul>
    </section>
  );
}

/** Tour d'amélioration : 6 branches de bonus permanents, coût du niveau suivant en rouge s'il manque. */
export function UpgradeTowerSection() {
  const save = useSession((s) => s.save)!;
  const upgradeTowerBranch = useSession((s) => s.upgradeTowerBranch);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [pending, setPending] = useState(false);
  const village = gameData.village;

  const buy = async (branch: UpgradeTowerBranchId, name: string, level: number) => {
    setPending(true);
    try {
      await upgradeTowerBranch(branch);
      notify('success', t('upgradeTower.done', { name, level }));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const formatBonus = (value: number, unit: string) =>
    unit === 'h' ? `+${formatNumber(value)} h` : `+${Math.round(value * 100)} %`;

  return (
    <section>
      <h3>{t('upgradeTower.title')}</h3>
      <ul className="upgrade-tower-list">
        {village.upgradeTower.branches.map((branch) => {
          const level = save.upgradeTower[branch.id] ?? 0;
          const step = nextUpgradeTowerStep(village, save.upgradeTower, branch.id);
          const resource = resourceById(branch.resourceId);
          const ether = resourceById('ether');
          const missing = step && {
            gold: save.gold < step.gold,
            ether: (view.resources.ether ?? 0) < step.ether,
            resource: (view.resources[step.resourceId] ?? 0) < step.branchResource,
          };
          const affordable = missing && !missing.gold && !missing.ether && !missing.resource;
          return (
            <li key={branch.id}>
              <div>
                <strong>{branch.name}</strong>{' '}
                <span className="muted">
                  {t('upgradeTower.level', { level, max: branch.maxLevel })} ·{' '}
                  {t('upgradeTower.bonus', {
                    value: formatBonus(
                      upgradeTowerBonus(village, save.upgradeTower, branch.id),
                      branch.unit,
                    ),
                  })}
                </span>
                <p className="muted small">{branch.effect}</p>
              </div>
              {step && missing ? (
                <div className="upgrade-tower-next">
                  <span>{t('upgradeTower.next', { level: step.level })}</span>
                  <ul className="cost-list">
                    <li className={missing.gold ? 'missing' : ''}>
                      <span className="gold-icon" aria-hidden="true" />
                      {t('building.goldCost', { gold: formatNumber(step.gold) })}
                    </li>
                    <li className={missing.ether ? 'missing' : ''}>
                      <PixelImage src={ether?.image ?? null} alt="" size={16} />
                      <span className="capitalize">
                        {formatNumber(step.ether)} {ether?.name ?? 'éther'}
                      </span>
                    </li>
                    <li className={missing.resource ? 'missing' : ''}>
                      <PixelImage src={resource?.image ?? null} alt="" size={16} />
                      <span className="capitalize">
                        {formatNumber(step.branchResource)} {resource?.name ?? step.resourceId}
                      </span>
                    </li>
                  </ul>
                  <button
                    type="button"
                    className="primary"
                    disabled={!affordable || pending}
                    onClick={() => void buy(branch.id, branch.name, step.level)}
                  >
                    {t('upgradeTower.buy')}
                  </button>
                </div>
              ) : (
                <p className="ok">{t('upgradeTower.max')}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
