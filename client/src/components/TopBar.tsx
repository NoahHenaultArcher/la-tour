import { NavLink, useLocation } from 'react-router';
import { t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';
import { ResourceBar } from './ResourceBar.tsx';

/** Bandeau fixe : nom du jeu, navigation, or (et ressources au village), déconnexion. */
export function TopBar() {
  const user = useSession((s) => s.user)!;
  const logout = useSession((s) => s.logout);
  const pointsToSpend = useSession(
    (s) => s.save?.characters.some((c) => c.statPoints.available > 0) ?? false,
  );
  const { pathname } = useLocation();
  return (
    <header className="topbar">
      <strong className="logo-small">{t('app.title')}</strong>
      <nav className="main-nav">
        <NavLink to="/village">{t('nav.village')}</NavLink>
        <NavLink to="/tour">{t('nav.tower')}</NavLink>
        <NavLink to="/chasse">{t('nav.hunt')}</NavLink>
        <NavLink to="/equipe">
          {t('nav.team')}
          {pointsToSpend && (
            <span className="nav-badge" title={t('nav.pointsToSpend')}>
              !
            </span>
          )}
        </NavLink>
      </nav>
      {/* Les ressources ne s'affichent qu'au village ; l'or reste visible partout. */}
      <ResourceBar withResources={pathname === '/village'} />
      <span className="topbar-user">{user.username}</span>
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        {t('auth.logout')}
      </button>
    </header>
  );
}
