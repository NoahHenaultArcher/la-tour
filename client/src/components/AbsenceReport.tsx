import { resourceById } from '../game/village.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';
import { Modal } from './Modal.tsx';
import { PixelImage } from './PixelImage.tsx';

function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0
    ? t('time.hoursMinutes', { h, m: String(m).padStart(2, '0') })
    : t('time.minutes', { m });
}

/** Fenêtre « Pendant votre absence » : ce que le village a produit depuis la dernière visite. */
export function AbsenceReport() {
  const report = useSession((s) => s.absenceReport);
  const dismiss = useSession((s) => s.dismissAbsenceReport);
  if (!report) return null;
  const capped = report.elapsedHours > report.countedHours + 1 / 60;

  return (
    <Modal open onClose={dismiss} title={t('absence.title')}>
      <p>{t('absence.duration', { duration: formatDuration(report.elapsedHours) })}</p>
      {capped && (
        <p className="warning">
          {t('absence.capped', { hours: formatNumber(Math.round(report.countedHours * 10) / 10) })}
        </p>
      )}
      <ul className="produced-list">
        {Object.entries(report.produced).map(([id, amount]) => {
          const resource = resourceById(id);
          return (
            <li key={id}>
              <PixelImage src={resource?.image ?? null} alt={resource?.name ?? id} size={24} />
              <span className="capitalize">{resource?.name ?? id}</span>
              <strong>+{formatNumber(amount)}</strong>
              {report.full.includes(id) && <em className="error">{t('absence.full')}</em>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="primary" onClick={dismiss}>
        {t('common.ok')}
      </button>
    </Modal>
  );
}
