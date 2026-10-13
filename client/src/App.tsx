import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AbsenceReport } from './components/AbsenceReport.tsx';
import { Notifications } from './components/Notifications.tsx';
import { TooltipProvider } from './components/Tooltip.tsx';
import { DebugPanel } from './debug/DebugPanel.tsx';
import { useDebug } from './debug/console.ts';
import { errorMessage, t } from './i18n/index.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { ChooseClassPage } from './pages/ChooseClassPage.tsx';
import { CombatPage } from './pages/CombatPage.tsx';
import { HuntPage } from './pages/HuntPage.tsx';
import { TeamPage } from './pages/TeamPage.tsx';
import { TowerPage } from './pages/TowerPage.tsx';
import { VillagePage } from './pages/VillagePage.tsx';
import { useSession } from './stores/session.ts';

/** Collecte régulière de la production tant que le joueur est en ligne. */
const COLLECT_EVERY_MS = 5 * 60_000;

/** Collecte périodique, et au retour sur l'onglet (avec la fenêtre « Pendant votre absence »). */
function useIdleCollection(active: boolean) {
  const collect = useSession((s) => s.collect);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void collect(false).catch(() => undefined), COLLECT_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void collect(true).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, collect]);
}

/**
 * Aiguillage : visiteur → connexion ; compte sans personnage → choix de la classe ; sinon → village.
 */
export function App() {
  const status = useSession((s) => s.status);
  const hasCharacter = useSession((s) => (s.save?.characters.length ?? 0) > 0);
  const init = useSession((s) => s.init);
  const debugOpen = useDebug((s) => s.open);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    init().catch((error: unknown) => setFatal(errorMessage(error)));
  }, [init]);
  useIdleCollection(status === 'ready');

  if (fatal) return <p className="error center">{fatal}</p>;
  if (status === 'loading') return <p className="muted center">{t('app.loading')}</p>;

  const home = status === 'anonymous' ? '/connexion' : hasCharacter ? '/village' : '/classe';
  const anonymousOnly = (page: ReactNode) =>
    status === 'anonymous' ? page : <Navigate to={home} replace />;

  return (
    <TooltipProvider>
      <Routes>
        <Route path="/connexion" element={anonymousOnly(<AuthPage mode="login" />)} />
        <Route path="/inscription" element={anonymousOnly(<AuthPage mode="register" />)} />
        <Route
          path="/classe"
          element={home === '/classe' ? <ChooseClassPage /> : <Navigate to={home} replace />}
        />
        <Route
          path="/village"
          element={home === '/village' ? <VillagePage /> : <Navigate to={home} replace />}
        />
        <Route
          path="/tour"
          element={home === '/village' ? <TowerPage /> : <Navigate to={home} replace />}
        />
        <Route
          path="/chasse"
          element={home === '/village' ? <HuntPage /> : <Navigate to={home} replace />}
        />
        <Route
          path="/equipe"
          element={home === '/village' ? <TeamPage /> : <Navigate to={home} replace />}
        />
        <Route
          path="/combat"
          element={home === '/village' ? <CombatPage /> : <Navigate to={home} replace />}
        />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
      {status === 'ready' && hasCharacter && <AbsenceReport />}
      <Notifications />
      {debugOpen && <DebugPanel />}
    </TooltipProvider>
  );
}
