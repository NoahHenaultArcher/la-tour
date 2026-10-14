import {
  ALCHEMY,
  ELEMENT_IDS,
  fusionCost,
  maxFusions,
  nextUpgradeTowerStep,
  upgradeTowerBonus,
  type ElementId,
  type UpgradeTowerBranchId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { elementName, elementStyle, fusionColor } from '../game/elements.ts';
import { resourceById, useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';
import { ElementBadge } from './ElementBadge.tsx';
import { PixelImage } from './PixelImage.tsx';

const ALCHEMY_LEVELS = [1, 2, 3, 4, 5];

/**
 * Tour d'alchimie : effets de chaque niveau, puis l'explorateur de combinaisons
 * (on choisit un élément, on voit ses 10 fusions avec leur effet).
 */
export function AlchemySection({ level }: { level: number }) {
  const navigate = useNavigate();
  const unlocked = useSession((s) => s.save?.unlockedElements ?? []);
  const [element, setElement] = useState<ElementId>(unlocked.at(-1) ?? 'neutral');

  // Les fusions de l'élément choisi, présentées « élément choisi + partenaire ».
  const recipes = gameData.skills.fusions
    .filter((f) => f.element1 === element || f.element2 === element)
    .map((f) => ({ fusion: f, partner: f.element1 === element ? f.element2 : f.element1 }))
    .sort((a, b) => ELEMENT_IDS.indexOf(a.partner) - ELEMENT_IDS.indexOf(b.partner));

  return (
    <section className="alchemy-section">
      <div className="alchemy-intro">
        <p>{t('alchemy.intro')}</p>
        <button type="button" className="primary" onClick={() => navigate('/competences')}>
          {t('alchemy.toSkills')}
        </button>
      </div>

      <h3>{t('alchemy.levelsTitle')}</h3>
      <table className="alchemy-levels">
        <thead>
          <tr>
            <th>{t('alchemy.col.level')}</th>
            <th>{t('alchemy.col.perHero')}</th>
            <th>{t('alchemy.col.cost')}</th>
            <th>{t('alchemy.col.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {ALCHEMY_LEVELS.map((n) => {
            const cost = fusionCost(n);
            return (
              <tr key={n} className={n === level ? 'current' : n < level ? 'reached' : 'upcoming'}>
                <td>
                  {t('alchemy.levelN', { level: n })}
                  {n === level && <span className="accent"> · {t('alchemy.current')}</span>}
                </td>
                <td>{maxFusions(n)}</td>
                <td>
                  {t('alchemy.costValue', {
                    ether: formatNumber(cost.ether),
                    gold: formatNumber(cost.gold),
                  })}
                </td>
                <td>
                  {n >= ALCHEMY.extraDurationLevel
                    ? t('alchemy.plusOneRound')
                    : t('alchemy.normal')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{t('alchemy.costNote')}</p>

      <h3>{t('alchemy.explorer')}</h3>
      <p className="muted small">{t('alchemy.explorerHint')}</p>
      <div className="alchemy-explorer">
        <div className="alchemy-elements" role="tablist" aria-label={t('alchemy.chooseElement')}>
          {ELEMENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === element}
              className={`alchemy-element${id === element ? ' selected' : ''}${unlocked.includes(id) ? '' : ' locked'}`}
              style={elementStyle(id)}
              onClick={() => setElement(id)}
            >
              {elementName(id)}
            </button>
          ))}
        </div>
        <ul className="alchemy-recipes">
          {recipes.map(({ fusion, partner }) => {
            const missing = [element, partner].filter(
              (id, i, pair) => !unlocked.includes(id) && pair.indexOf(id) === i,
            );
            return (
              <li
                key={fusion.name}
                className={missing.length === 0 ? '' : 'locked'}
                style={{ '--fusion': fusionColor(element, partner) } as CSSProperties}
              >
                <div className="alchemy-recipe-head">
                  <ElementBadge element={element} />
                  <span aria-hidden="true">+</span>
                  <ElementBadge element={partner} />
                  <span aria-hidden="true">=</span>
                  <strong className="alchemy-recipe-name">{fusion.name}</strong>
                </div>
                <span className="muted small">{fusion.role}</span>
                <span>{fusion.combatEffect}</span>
                <span className={`small ${missing.length === 0 ? 'ok' : 'missing'}`}>
                  {missing.length === 0
                    ? t('skills.synergies.available')
                    : t('skills.synergies.missing', {
                        elements: missing.map((id) => elementName(id)).join(', '),
                      })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Tour d'amélioration : 6 branches de bonus permanents, une ligne chacune, boutons alignés. */
export function UpgradeTowerSection() {
  const save = useSession((s) => s.save)!;
  const upgradeTowerBranch = useSession((s) => s.upgradeTowerBranch);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [pending, setPending] = useState(false);
  const village = gameData.village;
  const ether = resourceById('ether');

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
      <div className="upgrade-tower-head muted small" aria-hidden="true">
        <span>{t('upgradeTower.col.branch')}</span>
        <span>{t('upgradeTower.col.level')}</span>
        <span>{t('upgradeTower.col.cost')}</span>
        <span />
      </div>
      <ul className="upgrade-tower-list">
        {village.upgradeTower.branches.map((branch) => {
          const level = save.upgradeTower[branch.id] ?? 0;
          const step = nextUpgradeTowerStep(village, save.upgradeTower, branch.id);
          const resource = resourceById(branch.resourceId);
          const missing = step && {
            gold: save.gold < step.gold,
            ether: (view.resources.ether ?? 0) < step.ether,
            resource: (view.resources[step.resourceId] ?? 0) < step.branchResource,
          };
          const affordable = missing && !missing.gold && !missing.ether && !missing.resource;
          const bonus = upgradeTowerBonus(village, save.upgradeTower, branch.id);
          const nextBonus = step
            ? upgradeTowerBonus(
                village,
                { ...save.upgradeTower, [branch.id]: step.level },
                branch.id,
              )
            : null;
          return (
            <li key={branch.id}>
              <div className="upgrade-tower-branch">
                <strong>{branch.name}</strong>
                <span className="muted small">{branch.effect}</span>
              </div>
              <div className="upgrade-tower-progress">
                <span>
                  {t('upgradeTower.level', { level, max: branch.maxLevel })} ·{' '}
                  <strong className="accent">{formatBonus(bonus, branch.unit)}</strong>
                  {nextBonus !== null && (
                    <span className="ok"> → {formatBonus(nextBonus, branch.unit)}</span>
                  )}
                </span>
                <span
                  className="progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={branch.maxLevel}
                  aria-valuenow={level}
                >
                  <span style={{ width: `${(level / branch.maxLevel) * 100}%` }} />
                </span>
              </div>
              {step && missing ? (
                <>
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
                    {t('upgradeTower.buyLevel', { level: step.level })}
                  </button>
                </>
              ) : (
                <>
                  <span />
                  <strong className="ok">{t('upgradeTower.maxShort')}</strong>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
