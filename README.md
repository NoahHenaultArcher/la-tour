# La Tour

RPG au tour par tour, pixel art, dans le navigateur. Cahier des charges : [docs/Prompt_RPG_Tour.md](docs/Prompt_RPG_Tour.md).

## Organisation

| Dossier    | Rôle                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| `shared/`  | Constantes, schémas Zod, règles de calcul (stats, XP, coûts, production…) et données JSON. |
| `server/`  | API Fastify, Prisma (PostgreSQL).                                                          |
| `client/`  | Interface React + Vite.                                                                    |
| `scripts/` | `import-data.ts` : classeurs Excel (`docs/`) → JSON typés (`shared/data/`).                |

## Prérequis

- Node.js 24 et pnpm 10 (`npm install -g pnpm`).
- Docker Desktop, pour PostgreSQL (`docker-compose.yml`, image `postgres:17-alpine`).

## Mise en route

```powershell
pnpm install
Copy-Item .env.example .env   # puis adapter si besoin
pnpm import-data              # classeurs → shared/data/*.json
pnpm test                     # formules comparées aux valeurs des classeurs
pnpm db:up                    # démarre PostgreSQL (Docker)
pnpm db:migrate               # crée les tables
pnpm db:seed                  # crée le compte admin (mot de passe : ADMIN_PASSWORD du .env)
pnpm dev                      # serveur (port 3000) + client (http://localhost:5173)
```

## Données du jeu

Les chiffres d'équilibrage viennent **uniquement** des classeurs de `docs/`. Après toute modification
d'un classeur, relancer `pnpm import-data` puis `pnpm test`. L'import échoue avec un message précis
(classeur, onglet, cellule) si une donnée manque ou est incohérente. Ne pas modifier `shared/data/*.json`
à la main.

## Équilibrage hors classeurs

Les réglages absents des classeurs (stats de base des héros, formules de combat : esquive,
variance, comportement des monstres, coût des fusions…) sont regroupés dans `shared/src/balance.ts`.
Les effets des compétences, décrits en texte libre dans `Competences_RPG_Tour.xlsx`, sont traduits
en règles dans `shared/src/combat/effects.ts` (un test vérifie que les 79 compétences de base et les
55 fusions en ont toutes une). Après une modification, `pnpm test` relance la simulation
`shared/src/combat/simulation.test.ts`, qui vérifie que le début de partie reste faisable sans
équipement et qu'un deck complet aide sans rendre la tour triviale.

## Multijoueur

Le temps réel passe par Socket.IO, sur le même serveur que l'API (`/socket.io`, relayé par Vite
en développement). La connexion est authentifiée par le cookie de session et chaque événement est
validé par Zod (`shared/src/api/multiplayer.ts`). Les salons vivent en mémoire du serveur
(`server/src/multiplayer/manager.ts`) : un redémarrage les ferme, mais les récompenses d'un combat
sont écrites en base dès sa fin (ou dès qu'un joueur retire son héros d'une chasse). Pour tester à
plusieurs sur une seule machine, ouvrez un second navigateur (ou une fenêtre privée) avec un autre
compte.

## Mode debug

Dans la console du navigateur : `debug.enable()` ouvre le panneau, `debug.disable()` le ferme.
Les actions ne fonctionnent qu'avec un compte **admin** (créé par `pnpm db:seed`) et les routes
de debug n'existent pas en production.

## Tests

`pnpm test` lance tous les tests. Ceux du serveur utilisent le schéma PostgreSQL `test` (séparé des
données de développement) ; si la base est éteinte, ils sont ignorés avec un avertissement.

## Autres commandes

`pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm build`, `pnpm db:studio`.
