/**
 * Minuterie dans un Worker : contrairement aux minuteries de la page, le navigateur ne la ralentit
 * pas quand l'onglet est en arrière-plan. Reçoit { id, ms } et renvoie l'id une fois le délai écoulé.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; ms: number }>) => void) | null;
  postMessage: (id: number) => void;
};

scope.onmessage = (event) => {
  const { id, ms } = event.data;
  setTimeout(() => scope.postMessage(id), ms);
};
