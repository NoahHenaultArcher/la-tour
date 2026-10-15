import { MAX_HERO_LEVEL, canInherit } from '@la-tour/shared';
import { Link, NavLink } from 'react-router';
import { t } from '../i18n/index.ts';
import { useRoom } from '../stores/room.ts';
import { useSession } from '../stores/session.ts';
import { PixelImage } from './PixelImage.tsx';
import { ResourceBar } from './ResourceBar.tsx';
import { SoundControl } from './SoundControl.tsx';

/** Image du bâtiment « Tour » du village, reprise comme logo du jeu. */
const TOWER_IMAGE = 'village/tour.png';

/** Bandeau fixe : nom du jeu, navigation, or (et ressources au village), déconnexion. */
export function TopBar() {
  const user = useSession((s) => s.user)!;
  const logout = useSession((s) => s.logout);
  const pointsToSpend = useSession(
    (s) => s.save?.characters.some((c) => c.statPoints.available > 0) ?? false,
  );
  // L'héritage apparaît dans le menu dès qu'il est possible (ou déjà fait une fois).
  const heritage = useSession((s) =>
    s.save ? canInherit(s.save.characters, MAX_HERO_LEVEL) || s.save.heritageCount > 0 : false,
  );
  const heritageReady = useSession((s) =>
    s.save ? canInherit(s.save.characters, MAX_HERO_LEVEL) : false,
  );
  const inRoom = useRoom((s) => s.room !== null);
  return (
    <header className="topbar">
      <Link to="/accueil" className="logo-small">
        <PixelImage src={TOWER_IMAGE} alt="" size={28} />
        <strong>{t('app.title')}</strong>
      </Link>
      <nav className="main-nav">
        <NavLink to="/accueil">{t('nav.home')}</NavLink>
        <NavLink to="/tour">{t('nav.tower')}</NavLink>
        <NavLink to="/village">{t('nav.village')}</NavLink>
        <NavLink to="/chasse">{t('nav.hunt')}</NavLink>
        <NavLink to="/equipe">
          {t('nav.team')}
          {pointsToSpend && (
            <span className="nav-badge" title={t('nav.pointsToSpend')}>
              !
            </span>
          )}
        </NavLink>
        <NavLink to="/competences">{t('nav.skills')}</NavLink>
        <NavLink to={inRoom ? '/salon' : '/multi'}>{t('nav.multi')}</NavLink>
        {heritage && (
          <NavLink to="/heritage">
            {t('nav.heritage')}
            {heritageReady && <span className="nav-badge">!</span>}
          </NavLink>
        )}
      </nav>
      {/* L'or reste visible partout ; les ressources ont leur propre barre sur la page du village. */}
      <ResourceBar withResources={false} />
      <SoundControl />
      <span className="topbar-user">{user.username}</span>
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        {t('auth.logout')}
      </button>
    </header>
  );
}
