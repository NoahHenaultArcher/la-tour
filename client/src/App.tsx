import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AbsenceReport } from './components/AbsenceReport.tsx';
import { Notifications } from './components/Notifications.tsx';
import { TooltipProvider } from './components/Tooltip.tsx';
import { useDebug } from './debug/console.ts';
import { errorMessage, t } from './i18n/index.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { VillagePage } from './pages/VillagePage.tsx';
import { useRoom } from './stores/room.ts';
import { useSession } from './stores/session.ts';

/**
 * Pages chargées à la demande (le village et la connexion sont dans le fichier principal) :
 * le jeu s'ouvre plus vite, puis les autres pages se préchargent en arrière-plan.
 */
const pageLoaders = {
  ChooseClassPage: () => import('./pages/ChooseClassPage.tsx'),
  TowerPage: () => import('./pages/TowerPage.tsx'),
  HuntPage: () => import('./pages/HuntPage.tsx'),
  TeamPage: () => import('./pages/TeamPage.tsx'),
  SkillsPage: () => import('./pages/SkillsPage.tsx'),
  MultiPage: () => import('./pages/MultiPage.tsx'),
  RoomPage: () => import('./pages/RoomPage.tsx'),
  HeritagePage: () => import('./pages/HeritagePage.tsx'),
  CombatPage: () => import('./pages/CombatPage.tsx'),
  DebugPanel: () => import('./debug/DebugPanel.tsx'),
};
const ChooseClassPage = lazy(() =>
  pageLoaders.ChooseClassPage().then((m) => ({ default: m.ChooseClassPage })),
);
const TowerPage = lazy(() => pageLoaders.TowerPage().then((m) => ({ default: m.TowerPage })));
const HuntPage = lazy(() => pageLoaders.HuntPage().then((m) => ({ default: m.HuntPage })));
const TeamPage = lazy(() => pageLoaders.TeamPage().then((m) => ({ default: m.TeamPage })));
const SkillsPage = lazy(() => pageLoaders.SkillsPage().then((m) => ({ default: m.SkillsPage })));
const MultiPage = lazy(() => pageLoaders.MultiPage().then((m) => ({ default: m.MultiPage })));
const RoomPage = lazy(() => pageLoaders.RoomPage().then((m) => ({ default: m.RoomPage })));
const HeritagePage = lazy(() =>
  pageLoaders.HeritagePage().then((m) => ({ default: m.HeritagePage })),
);
const CombatPage = lazy(() => pageLoaders.CombatPage().then((m) => ({ default: m.CombatPage })));
const DebugPanel = lazy(() => pageLoaders.DebugPanel().then((m) => ({ default: m.DebugPanel })));

/** Préchargement discret des pages une fois le joueur connecté (navigation instantanée ensuite). */
function usePrefetchPages(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      for (const load of Object.values(pageLoaders)) void load().catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [active]);
}

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
  usePrefetchPages(status === 'ready');
  // Connexion temps réel (multijoueur) dès qu'un joueur a un héros ; coupée à la déconnexion.
  const connectRoom = useRoom((s) => s.connect);
  const disconnectRoom = useRoom((s) => s.disconnect);
  useEffect(() => {
    if (status === 'ready' && hasCharacter) connectRoom();
    if (status === 'anonymous') disconnectRoom();
  }, [status, hasCharacter, connectRoom, disconnectRoom]);

  if (fatal) return <p className="error center">{fatal}</p>;
  if (status === 'loading') return <p className="muted center">{t('app.loading')}</p>;

  const home = status === 'anonymous' ? '/connexion' : hasCharacter ? '/village' : '/classe';
  const anonymousOnly = (page: ReactNode) =>
    status === 'anonymous' ? page : <Navigate to={home} replace />;

  return (
    <TooltipProvider>
      <Suspense fallback={<p className="muted center">{t('app.loading')}</p>}>
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
            path="/competences"
            element={home === '/village' ? <SkillsPage /> : <Navigate to={home} replace />}
          />
          <Route
            path="/multi"
            element={home === '/village' ? <MultiPage /> : <Navigate to={home} replace />}
          />
          <Route
            path="/salon"
            element={home === '/village' ? <RoomPage /> : <Navigate to={home} replace />}
          />
          <Route
            path="/heritage"
            element={home === '/village' ? <HeritagePage /> : <Navigate to={home} replace />}
          />
          <Route
            path="/combat"
            element={home === '/village' ? <CombatPage /> : <Navigate to={home} replace />}
          />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Suspense>
      {status === 'ready' && hasCharacter && <AbsenceReport />}
      <Notifications />
      {debugOpen && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
    </TooltipProvider>
  );
}
