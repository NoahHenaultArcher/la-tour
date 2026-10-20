import type {
  AllocateStatPointsBody,
  ApiErrorBody,
  BuyOfferBody,
  CharacterIdBody,
  ApiErrorCode,
  ChooseClassBody,
  CollectResponse,
  CombatActionBody,
  CombatResponse,
  CraftItemBody,
  EquipItemBody,
  EquipRelicBody,
  UnequipRelicBody,
  ItemIdBody,
  ItemIdsBody,
  LeaderboardDto,
  UpgradeBuildingBody,
  UpgradeTowerBranchBody,
  LoginBody,
  RegisterBody,
  SaveDto,
  SetDeckBody,
  ShopDto,
  UserDto,
} from '@la-tour/shared';

/** Erreur renvoyée par le serveur : le code se traduit via fr.json (errors.<code>). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'INTERNAL');
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'INTERNAL', error?.details);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: UserDto }>('GET', '/api/auth/me'),
  register: (body: RegisterBody) => request<{ user: UserDto }>('POST', '/api/auth/register', body),
  login: (body: LoginBody) => request<{ user: UserDto }>('POST', '/api/auth/login', body),
  logout: () => request<void>('POST', '/api/auth/logout'),
  getSave: () => request<SaveDto>('GET', '/api/save'),
  chooseClass: (body: ChooseClassBody) => request<SaveDto>('POST', '/api/save/class', body),
  debug: (action: string, body: object = {}) =>
    request<SaveDto>('POST', `/api/debug/${action}`, body),
  collect: () => request<CollectResponse>('POST', '/api/village/collect', {}),
  getCombat: () => request<CombatResponse>('GET', '/api/combat'),
  startCombat: (floor: number) => request<CombatResponse>('POST', '/api/combat/start', { floor }),
  combatAction: (body: CombatActionBody) =>
    request<CombatResponse>('POST', '/api/combat/action', body),
  combatPass: () => request<CombatResponse>('POST', '/api/combat/pass', {}),
  combatAuto: () => request<CombatResponse>('POST', '/api/combat/auto', {}),
  combatForfeit: () => request<CombatResponse>('POST', '/api/combat/forfeit', {}),
  startAbyss: () => request<CombatResponse>('POST', '/api/combat/abyss', {}),
  startHunt: (zoneFloor: number) =>
    request<CombatResponse>('POST', '/api/combat/hunt', { zoneFloor }),
  combatRetreat: () => request<CombatResponse>('POST', '/api/combat/retreat', {}),
  getShop: () => request<ShopDto>('GET', '/api/shop'),
  buyOffer: (body: BuyOfferBody) =>
    request<{ shop: ShopDto; save: SaveDto }>('POST', '/api/shop/buy', body),
  sellItem: (body: ItemIdBody) =>
    request<{ gold: number; save: SaveDto }>('POST', '/api/shop/sell', body),
  sellItems: (body: ItemIdsBody) =>
    request<{ gold: number; save: SaveDto }>('POST', '/api/shop/sell-many', body),
  buyBackItems: (body: ItemIdsBody) =>
    request<{ gold: number; save: SaveDto }>('POST', '/api/shop/buy-back', body),
  debugResetShop: () => request<ShopDto>('POST', '/api/debug/reset-shop', {}),
  debugWinWave: () => request<CombatResponse>('POST', '/api/debug/win-wave', {}),
  equipItem: (body: EquipItemBody) => request<SaveDto>('POST', '/api/items/equip', body),
  unequipItem: (body: ItemIdBody) => request<SaveDto>('POST', '/api/items/unequip', body),
  equipRelic: (body: EquipRelicBody) => request<SaveDto>('POST', '/api/relics/equip', body),
  unequipRelic: (body: UnequipRelicBody) => request<SaveDto>('POST', '/api/relics/unequip', body),
  upgradeItem: (body: ItemIdBody) => request<SaveDto>('POST', '/api/workshop/upgrade', body),
  craftItem: (body: CraftItemBody) => request<SaveDto>('POST', '/api/workshop/craft', body),
  allocateStatPoints: (body: AllocateStatPointsBody) =>
    request<SaveDto>('POST', '/api/characters/stats', body),
  resetStatPoints: (body: CharacterIdBody) =>
    request<SaveDto>('POST', '/api/characters/stats/reset', body),
  upgradeBuilding: (body: UpgradeBuildingBody) =>
    request<SaveDto>('POST', '/api/village/upgrade', body),
  upgradeTowerBranch: (body: UpgradeTowerBranchBody) =>
    request<SaveDto>('POST', '/api/village/upgrade-tower', body),
  setDeck: (body: SetDeckBody) => request<SaveDto>('POST', '/api/characters/deck', body),
  heritage: () => request<SaveDto>('POST', '/api/save/heritage', {}),
  getLeaderboard: () => request<LeaderboardDto>('GET', '/api/leaderboard'),
};
