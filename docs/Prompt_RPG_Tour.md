# Prompt — RPG tour par tour sur navigateur : « La Tour »

Tu vas développer avec moi un jeu vidéo complet : un RPG au tour par tour jouable dans le navigateur, en pixel art, en français. Ce document décrit **tout** le jeu. Lis-le en entier avant d'écrire du code, respecte les règles telles qu'elles sont écrites, et **pose-moi la question** dès qu'un point est flou ou absent plutôt que d'inventer une règle de jeu.

---

## 1. Vue d'ensemble

- Le joueur se connecte avec un pseudo et un mot de passe, puis retrouve **sa sauvegarde** (une seule par compte).
- À la première connexion, il choisit **une classe** parmi trois : **Guerrier**, **Tireur**, **Mage**.
- Le cœur du jeu est une **tour de 100 étages** à gravir en combats au tour par tour, découpée en **10 biomes** (un élément par biome).
- Entre deux combats, le joueur revient au **village** : ses bâtiments produisent des ressources en continu (même hors ligne), servent à améliorer l'équipement, à acheter des objets et de nouveaux personnages.
- Les étages de boss débloquent des **zones de chasse** où l'on farme à l'infini.
- Le joueur peut jouer **seul** (avec jusqu'à 3 personnages de classes différentes) ou en **multijoueur** (salon de 3 joueurs maximum, un personnage chacun).
- Au niveau 100, le joueur peut faire un **héritage** : il recommence la tour avec des statistiques augmentées.

---

## 2. Fichiers de référence (source de vérité)

Tous les chiffres d'équilibrage sont dans des classeurs Excel. **Ne les recopie pas à la main dans le code** : écris un script d'import qui lit les classeurs et génère des fichiers JSON typés (voir §15). Si une valeur du jeu manque dans les classeurs, demande-moi.

| Fichier | Contenu utile au code |
|---|---|
| `Resume_statistiques_RPG.xlsx` | Liste des statistiques, leur rôle, règles de conception (pas de mana, initiative de camp, actions par manche, recharges). |
| `Competences_RPG_Tour.xlsx` | 79 compétences de base, 484 variantes (10 éléments), recharges calculées, déblocages par niveau et par étage, 55 fusions, paramètres (actions par manche, ultime unique, etc.). |
| `Equipements_RPG_Tour.xlsx` | 930 objets (3 classes × 10 emplacements × 5 matériaux × 6 raretés) + 30 Uniques, profils de stats, formule de stats, coûts d'amélioration, matériaux et paliers. |
| `Bestiaire_Tour_RPG.xlsx` | 92 monstres (stats, initiative, altérations, éléments, rôles, rangs), 30 zones, 100 étages, XP et or par niveau, butin et raretés, **onglet Boutique** (prix de la taverne). |
| `Elements_Fusions_RPG_Tour.xlsx` | 10 éléments, effets, matrice d'avantages (×1,5 / ×0,75), fusions. |
| `Village_RPG_Tour.xlsx` | Bâtiments, production par heure niveau par niveau, coût de chaque amélioration (or, matériau, charbon, étage requis, effet), Tour d'amélioration. |
| Diagramme « Projet jeu web » | Vue d'ensemble : biomes, zones, boss, déblocages du village par étage. |
| Dossier `assets_rpg_tour/` + `manifest.json` | Images pixel art (voir §14). |

---

## 3. Stack technique

- **Langage** : TypeScript partout (client, serveur, code partagé).
- **Organisation** : monorepo pnpm avec 3 paquets :
  - `client` : l'interface.
  - `server` : l'API et le temps réel.
  - `shared` : moteur de combat, règles, types et données JSON. Ce paquet est importé par les deux autres.
- **Client** :
  - React + Vite.
  - Zustand pour l'état.
  - React Router pour les pages.
  - Floating UI ou Radix UI pour les infobulles et les fenêtres.
  - Affichage pixel art en CSS (`image-rendering: pixelated`).
  - La scène de combat se fait d'abord en DOM/CSS animé ; on pourra passer à PixiJS plus tard si besoin.
- **Serveur** :
  - Node.js + Fastify.
  - Socket.IO pour les salons multijoueurs et les combats en temps réel.
  - Zod pour valider toutes les entrées.
- **Base de données** :
  - PostgreSQL + Prisma.
  - Contenu : comptes, sauvegarde, personnages, inventaire, village, progression.
- **Authentification** :
  - Mots de passe hachés avec argon2.
  - Session dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` en production.
  - Limite de tentatives de connexion.
- **Tests** : Vitest, en priorité sur le moteur de combat, les formules (stats, XP, coûts, production idle) et les règles de déblocage.
- **Règle d'or : le serveur fait autorité.**
  - Le client affiche et envoie des intentions (« lancer telle compétence sur telle cible »).
  - Le serveur calcule les dégâts, le butin, l'XP, l'or, la production et les achats, puis renvoie le résultat.
  - Le client n'est jamais cru sur un chiffre.

---

## 4. Comptes, sauvegarde et mode debug

### Comptes
- Inscription et connexion avec **pseudo + mot de passe** uniquement (pas d'e-mail, donc pas de récupération de mot de passe : l'écrire sur la page d'inscription).
- Un compte = **une sauvegarde**. Un joueur peut créer plusieurs comptes s'il le souhaite.
- Sauvegarde **automatique côté serveur** après chaque action importante (fin de combat, achat, amélioration, équipement). Pas de bouton « sauvegarder ».

### Mode debug
- Activation par une **commande dans la console du navigateur** (outils de développement), par exemple `debug.enable()`. Elle ouvre un panneau de debug dans le jeu.
- **Sécurité** :
  - La commande ne fait qu'afficher le panneau.
  - Chaque action de debug est une requête que le serveur n'accepte **que si le compte connecté a le rôle admin** en base de données.
- **Compte admin** :
  - En développement, un script de seed crée un compte `admin`.
  - Son mot de passe est lu dans une variable d'environnement : `admin` en local, jamais en dur dans le code.
  - Les routes de debug sont **désactivées en production**.
- **Outils du panneau** :
  - Donner de l'or, des ressources, de l'XP ou des niveaux.
  - Aller directement à un étage, débloquer toute la tour ou un élément.
  - Créer un objet (classe, emplacement, palier, rareté, amélioration).
  - Gagner la vague en cours.
  - Avancer l'horloge idle de X heures.
  - Réinitialiser la boutique.

---

## 5. Personnages, classes et statistiques

### Classes
| Classe | Arme 1 | Arme 2 | Armure | Stat d'attaque |
|---|---|---|---|---|
| Guerrier | Épée | Bouclier | Lourde (cuir, fer, acier, mithril, adamantite) | Force |
| Mage | Bâton | Orbe | Tissu (lin, laine, soie, velours enchanté, étoffe astrale) | Magie |
| Tireur | Arc | Carquois | Cuir (toile, cuir, cuir clouté, écailles, peau de dragon) | Force |

### Équipe
- On commence avec **une** classe.
- Les deux autres s'achètent à la **taverne** (voir §11) : **50 400 or** pour le 2e personnage, **232 400 or** pour le 3e.
  - Les prix exacts sont dans l'onglet Boutique du bestiaire.
  - Un personnage acheté **disparaît de la boutique** et arrive au **niveau 1**.
- **Une seule fois chaque classe** : 3 personnages maximum dans l'équipe (pas trois mages).
- Chaque personnage a son niveau, son XP, son équipement (10 emplacements) et son deck de compétences.

### Statistiques (fichier Résumé statistiques)
- **Principales** (montent avec le niveau et l'équipement) : Vitalité, Force, Résistance, Magie, Agilité, **Initiative**.
- **D'équipement uniquement** : Précision, Chance de critique, Dégâts critiques, Armure, Pénétration, Résistance élémentaire, Bonus de soins, Résistance aux altérations.
- **Calculées** : Points de vie (Vitalité × 10), Esquive (dérivée de l'Agilité et de l'équipement).
- **Pas de mana.** Seules les recharges limitent les compétences.
- **Initiative de base de chaque classe** :
  - Valeur au niveau 100 : Guerrier 70, Mage 80, Tireur 100.
  - Elle suit la même courbe de niveau que les autres stats.
  - S'y ajoute l'Initiative de l'équipement : bottes, anneau 2, ceinture (Guerrier), collier (Mage), capuche et carquois (Tireur).

### Niveaux et XP
- Niveau maximum **100**. Courbe d'XP et XP des monstres : bestiaire, onglet Récompenses.
- **Partage de l'XP** selon le nombre de héros dans le combat, en solo comme en multi :
  - 1 héros : 100 % ;
  - 2 héros : 75 % chacun ;
  - 3 héros : 50 % chacun.

### Emplacements d'équipement (10)
Chapeau, Armure, Pantalon, Bottes, Collier, Anneau 1, Anneau 2, Ceinture, Arme 1, Arme 2.

---

## 6. Combat

### Structure d'un étage
| Type d'étage | Vagues | Contenu |
|---|---|---|
| Normal | 3 | 3 monstres par vague, tirés dans la zone de la tranche de 5 étages. |
| Boss (étages 5, 10, 15, …) | 5 | 4 vagues normales, puis le boss + 2 escortes. |
| Dragon (étages 9, 19, 29, …) | 1 | Le dragon de l'élément du biome, seul (« sac à PV »). |

- Les monstres ont le **niveau de l'étage** (étage 84 → niveau 84).
- Les **PV des héros sont conservés entre les vagues** d'un même étage et restaurés à la fin de l'étage.

### Déroulement d'une manche
1. **Ordre des camps** : on calcule l'initiative **moyenne** des héros vivants et celle des monstres vivants de la vague.
   - Le camp le plus haut **joue en entier**, puis l'autre camp.
   - Égalité : les héros commencent.
   - Afficher une **frise d'initiative** qui montre quel camp joue.
2. **Tour des héros** :
   - **Solo** : l'équipe a **3 actions par manche**, quel que soit le nombre de personnages (1 à 3). Le joueur choisit qui agit et avec quelle compétence. Par exemple : 1 action chacun, 2 + 1 + 0, ou 3 actions pour un seul personnage.
   - **Multi** : chaque joueur a **3 actions** pour son personnage.
3. **Tour des monstres** : chaque monstre agit selon son rôle (bête, brute, mage, soutien, assassin…), dans l'ordre de son initiative individuelle.
4. Fin de manche : les recharges baissent de 1, les altérations s'appliquent ou expirent.

### Deck de compétences
- Chaque personnage équipe **5 compétences** : **3 actives + 2 passives**, avec **une seule ultime** parmi les actives.
- **Recharges** (calculées dans le fichier Compétences, colonne H de Bases) :
  - **0** : les compétences du **kit de départ** (débloquées au niveau 1). Utilisables à chaque action, plusieurs fois par manche.
  - **1** : utilisable à chaque manche.
  - **2** : une manche de pause.
  - **3** : deux manches de pause (ultimes).
- Une compétence avec recharge ne peut être lancée **qu'une fois par manche**.
- **Kit de départ** : 2 actives sans recharge + 1 passif, en élément Neutre. Exemple pour le Guerrier : Frappe rapide, Coup d'estoc, Peau dure.
- **Déblocages** :
  - Les compétences de base se débloquent par niveau (1 à 60).
  - Les variantes élémentaires se débloquent en terminant le dernier étage du biome de l'élément : Terre 20, Feu 30, Vent 40, Acide 50, Eau 60, Glace 70, Électricité 80, Lumière 90, Ombre 100.
- **Fusions** : deux éléments sur une même compétence (puissance ×1,10 et effet propre), à la Tour d'alchimie.

### Dégâts et éléments
- Les formules de dégâts, d'armure, de résistance, de critique et de pénétration suivent les paramètres du bestiaire (onglet Paramètres) et du fichier Équipements.
- **Avantage élémentaire** : ×1,5 ; **résistance** : ×0,75 (matrice dans `Elements_Fusions`).
- **Altérations** (brûlure, gel, saignement, assommé…) : effet, durée, cumul et résistance sont dans le bestiaire, onglet Altérations.
  - Les contrôles sont divisés par 2 sur les boss.
  - Aucune immunité totale.

### Options de confort
- **Solo uniquement** :
  - Un bouton **mode auto** : l'IA joue les 3 actions.
  - Un bouton de **vitesse** : ×1, ×2, ×3.
- **Multi** : ni mode auto, ni accélération.

### Défaite
- Retour au **village** avec un message de défaite qui conseille, par exemple : « Améliorez vos armes ou demandez de l'aide en multijoueur. »
- L'XP et le butin déjà gagnés pendant l'étage sont conservés ; l'étage n'est pas validé.

---

## 7. La tour, les biomes et les zones de chasse

### Biomes (10 étages chacun)
| Étages | Biome | Élément |
|---|---|---|
| 1–10 | Forêt | Neutre |
| 11–20 | Montagne | Terre |
| 21–30 | Volcan | Feu |
| 31–40 | Désert | Vent |
| 41–50 | Marais | Acide |
| 51–60 | Océan / île | Eau |
| 61–70 | Iceberg | Glace |
| 71–80 | Haute montagne | Électricité |
| 81–90 | Palais céleste | Lumière |
| 91–100 | Palais démoniaque | Ombre |

Les zones, monstres et boss de chaque tranche de 5 étages sont dans le bestiaire (onglets Zones, Monstres, Étages).

### Progression
- On avance **étage par étage**, dans l'ordre.
- **Seuls les étages de boss et de dragon sont rejouables** : 5, 9, 10, 15, 19, 20, 25, 29, 30… Un étage normal (par exemple le 4) ne se rejoue pas.
- **Battre un étage de boss débloque une zone de chasse** :
  - On y affronte à l'infini les monstres de la zone, **sans le boss**. Exemple : finir l'étage 5 débloque la Forêt de chasse et ses monstres des étages 1 à 5.
  - Le niveau des monstres est tiré entre l'étage de la zone et cet étage + 10.
  - Les tannières de dragon n'ont pas de zone de chasse.
- **Pour farmer un boss** (et ses objets Uniques), il faut **rejouer l'étage du boss**.

---

## 8. Butin

- **Solo** : **un seul tirage** de butin par combat. L'objet est tiré pour une classe au hasard parmi celles de l'équipe.
- **Multi** : **un tirage par joueur**, chacun reçoit son propre butin. Afficher à la fin du combat **qui a obtenu quoi** pour tous les joueurs (comme dans Dofus).
- Chances de drop par rang (faible, normal, fort, boss, dragon) et raretés par biome : bestiaire, onglet Butin.
- Un objet tombe à **+0**, dans le **matériau du palier de l'étage** (bois étages 1–14, fer 15–29, acier 30–49, mithril 50–69, adamantite 70+, équivalents pour les autres familles).

### Raretés (cadres dans `ui/cadre_*.png`)
| Rareté | Contenu |
|---|---|
| Commun, Rare, Super rare, Épique, Mythique, Légendaire | Stats seulement. Nom = type + matériau (« Épée en fer »). |
| **Unique** | Stats + **passif**, nom unique (« Épée de la Mort »). Lâché par les boss et dragons de son biome. |

Chaque rareté débloque un nombre de lignes de stats (onglet Paramètres du fichier Équipements).

---

## 9. Équipement et amélioration

- Chaque type d'objet existe dans **5 matériaux** (paliers). Un matériau supérieur est plus puissant.
- **Aucun niveau requis pour porter un objet** : un personnage de niveau 1 peut porter de l'adamantite.
- **Amélioration** (à l'Atelier de fabrication) :
  - Elle coûte le **matériau de l'objet** (une épée en bois s'améliore avec du bois). La quantité augmente à chaque niveau.
  - Formule et plafonds : fichier Équipements, onglets Amélioration et Matériaux.
  - Pas de temps d'attente : c'est instantané.
- **Fabrication** : l'Atelier fabrique des objets Commun +0 à partir des ressources.
- **Affichage obligatoire** : pour chaque objet, montrer le coût du niveau suivant, en rouge s'il manque des ressources.

---

## 10. Le village

Toutes les valeurs sont dans `Village_RPG_Tour.xlsx`.

### Bâtiments
| Bâtiment | Débloqué à l'étage | Rôle |
|---|---|---|
| Taverne | 0 | Marchand : objets, ressources, personnages (§11). |
| Entrepôt | 0 | Capacité maximale de chaque ressource. |
| Scierie | 0 | Bois, chêne, frêne, ébène, if. |
| Champs | 0 | Lin, laine, soie, velours enchanté, étoffe astrale. |
| Terrain de chasse | 0 | Cuir, cuir clouté, écailles, peau et os de dragon. |
| Mine | 15 | Charbon, fer, quartz, argent, acier, améthyste, or, mithril, cristal, saphir, platine, adamantite, diamant, orichalque. |
| Atelier de fabrication | 15 | Fabrication et amélioration d'équipement ; chaque niveau ouvre un palier. |
| Tour d'alchimie | 85 | Fusions d'éléments, infusion ; produit l'éther. |
| Tour d'amélioration | 100 | Bonus permanents en % (§10, dernier point). |
| Tour | 0 | Entrée de la tour et des zones de chasse. |

### Production idle
- Les bâtiments de production produisent **en continu, même hors ligne**, pendant **8 heures maximum**. Ensuite ils s'arrêtent jusqu'à la prochaine connexion.
- Le stock est plafonné par l'**Entrepôt**.
- Calcul **côté serveur** à partir de l'heure de dernière collecte, jamais avec une horloge du client.
- À la connexion, afficher une fenêtre **« Pendant votre absence »** avec ce qui a été produit.

### Améliorer un bâtiment
- Chaque niveau augmente la production des ressources déjà débloquées (+12 %). À certains niveaux, il **débloque la ressource suivante** (Scierie niveau 6 : chêne et frêne).
- **Coût** : de l'or + un matériau de construction (bois, fer, acier, mithril ou adamantite selon l'étage) + du charbon à partir de l'étage 15.
- Chaque niveau demande aussi d'avoir atteint un **étage** : pas d'acier avant l'étage 30.
- **Instantané**, pas de temps de construction.
- **Panneau de chaque bâtiment** : niveau actuel, production par heure de chaque ressource, et pour le **niveau suivant** l'étage requis, l'or, les matériaux (en rouge s'il en manque) et l'effet. Les données sont dans l'onglet Améliorations.

### Tour d'amélioration
6 branches de bonus permanents, chacune avec ses niveaux et ses coûts (onglet dédié) :
- Dégâts, PV et Défense : +1 % par niveau ;
- Production du village : +5 % par niveau ;
- Durée hors ligne : +1 h par niveau ;
- Or et XP : +2 % par niveau.

---

## 11. La taverne (boutique)

Tout est dans l'onglet **Boutique** du bestiaire.
- L'assortiment se **renouvelle toutes les heures** (heure réelle, même hors ligne) : **6 objets** et **4 lots de ressources**, plus avec le niveau de la taverne.
- **Objets vendus** :
  - Raretés Commun à Épique, à +0, pour les classes possédées, dans les paliers déjà débloqués.
  - Mythique, Légendaire et Unique ne sont jamais vendus.
- **Ressources** :
  - Lots de 10, au prix d'environ 1 minute de chasse dans la zone du palier.
  - Toile, verre et cuivre ne s'obtiennent qu'ici.
- **Personnages** : les classes non possédées sont toujours en vente ; elles disparaissent une fois achetées.
- **Utilité de l'or** : acheter des ressources, de l'équipement, des personnages, et améliorer les bâtiments.

---

## 12. Multijoueur

- Le joueur **crée un salon** et partage un **code**. **3 joueurs maximum** (lui compris).
- **Choix du contenu par l'hôte** :
  - son **étage courant** (pour aider à monter) ;
  - un **étage de boss** déjà débloqué ;
  - une **zone de chasse** déjà débloquée.
- En rejoignant, chaque joueur **choisit le personnage qu'il emmène** : une fenêtre de sélection s'il en a plusieurs, choix automatique s'il n'en a qu'un.
- **Un personnage par joueur** ; deux joueurs peuvent avoir la **même classe**.
- **Avant et pendant le combat** :
  - Un bouton **« Prêt »** avant de lancer le combat.
  - Un petit **chat** dans le salon.
  - Chaque joueur a **3 actions par manche**.
  - Un **minuteur de 60 secondes** par tour ; à la fin, les actions restantes sont passées.
- **Déconnexion** : le personnage du joueur déconnecté joue automatiquement ses compétences sans recharge jusqu'à son retour ou la fin du combat.
- **Butin** individuel avec l'affichage « qui a obtenu quoi » (§8). XP partagée selon §5.
- **Progression d'un invité (règle par défaut, à valider avec moi)** : la victoire ne fait monter un participant d'un étage que si c'était **son propre étage courant**. On ne saute pas d'étages en se faisant porter.
- Le multi est volontairement plus fort que le solo (3 actions par joueur), pour encourager l'entraide. Le solo doit rester faisable mais plus difficile.

---

## 13. Héritage

- Disponible quand un personnage atteint le **niveau 100**.
- **Réinitialisé** :
  - le niveau et les statistiques des personnages (retour au niveau 1) ;
  - la progression de la tour ;
  - les zones de chasse débloquées.
- **Conservé** :
  - les ressources, l'or, l'équipement ;
  - le village (niveaux, bâtiments débloqués, récompenses d'étage comme le niveau de la mine) ;
  - les compétences et éléments débloqués.
- **Bonus** : **+25 % de statistiques** par héritage, **cumulatif** (3 héritages = +75 %).
- Il faut refaire la tour pour débloquer à nouveau les étages et les zones.
- À valider avec moi : héritage de tout le compte (tous les personnages en même temps, car la tour est commune), déclenché quand au moins un personnage est niveau 100.

---

## 14. Interface (PC d'abord, en français)

### Pages
1. **Connexion / Inscription**.
2. **Choix de la classe de départ** (première connexion) : les 3 classes avec image, rôle et kit de départ.
3. **Village** (page centrale) : chaque bâtiment est cliquable et ouvre son panneau.
4. **Tour** : la colonne des 100 étages par biome, l'étage courant mis en avant, les étages de boss et de dragon rejouables marqués, les étages verrouillés grisés.
5. **Zones de chasse** : la liste des zones débloquées, avec niveau des monstres, monstres présents et butin possible.
6. **Équipe** : les 10 emplacements par personnage, l'inventaire, les stats détaillées, le deck (3 actives + 2 passives) et la comparaison avec l'objet équipé.
7. **Combat** : la scène, les PV, la frise d'initiative, les compétences avec leur recharge, le compteur d'actions restantes, le journal de combat, les boutons auto et vitesse (solo seulement).
8. **Salon multi** : code, joueurs, personnages choisis, bouton « Prêt », chat.
9. **Héritage** : récapitulatif de ce qui est perdu, gardé et gagné, puis confirmation.

### Éléments fixes
- **Barre de ressources** en haut de l'écran : or et ressources principales, avec production par heure au survol.
- **Notifications** : butin, montée de niveau, déblocage d'élément, de zone ou de bâtiment.

### Infobulles au survol (obligatoires)
- **Objet** : nom coloré selon la rareté, stats, passif s'il s'agit d'un Unique, niveau d'amélioration, comparaison avec l'objet équipé.
- **Ressource** : nom, quantité, provenance (bâtiment, butin, taverne), production par heure.
- **Compétence** : élément, puissance, recharge, cible, effet, condition de déblocage.
- **Monstre** : niveau, élément, faiblesses et résistances, altérations.
- **Bouton « Améliorer »** : coût du niveau suivant, étage requis, effet.

### Style
- Pixel art (images du dossier `assets_rpg_tour`), sans lissage.
- Les couleurs de rareté reprennent les cadres `ui/cadre_*.png`.
- Tous les textes de l'interface sont dans un fichier de traduction `fr.json`, même s'il n'y a qu'une langue.

### Images
- `manifest.json` liste les fichiers. Les noms suivent ceux des classeurs. Exemples :
  - `GUE-AR1-P2_epee_en_fer.png` pour un équipement ;
  - `village/mine.png` pour un bâtiment ;
  - `ressources/fer.png` pour une ressource.
- Une image absente ne doit pas faire planter le jeu : prévoir une image par défaut.

---

## 15. Données : import des classeurs

- Écris un script `scripts/import-data.ts` qui lit les 6 classeurs (avec `exceljs` ou `xlsx`) et produit des **JSON typés** dans `shared/data/`.
  - Il lit les **valeurs calculées** des cellules, pas les formules.
  - Une sortie par domaine : stats, compétences, équipements, monstres, zones, étages, butin, boutique, village, éléments.
- Valider les JSON au chargement avec Zod. Si une donnée est incohérente, le script échoue avec un message clair.
- Les règles de calcul (stats d'un objet à un niveau, production à un niveau, XP, coûts) sont **réimplémentées dans `shared`** avec les paramètres importés. Des tests comparent leurs résultats aux valeurs des classeurs.

---

## 16. Sécurité et qualité

- Toutes les entrées (HTTP et Socket.IO) sont validées par Zod côté serveur.
- **Toutes les opérations sensibles sont faites et vérifiées par le serveur** :
  - achat, amélioration, collecte idle, butin, fin de combat ;
  - vérification de l'or, des ressources, de l'étage et de l'appartenance de l'objet.
- Limite de requêtes sur la connexion et les actions sensibles.
- Aucun secret dans le code client. Les variables d'environnement sont dans un `.env` non versionné, avec un `.env.example` fourni.
- Écritures en base faites en **transactions** : un achat retire l'or et ajoute l'objet ensemble, ou rien du tout.
- Code lisible, découpé par domaine. Noms de variables en anglais, textes affichés en français.

---

## 17. Plan de développement par phases

Avance **phase par phase**. À la fin de chaque phase :
- montre-moi ce qui marche ;
- dis-moi comment le tester ;
- liste les questions en suspens.

Ne commence pas la phase suivante sans mon accord.

1. **Socle** : monorepo, outils, base de données, script d'import des classeurs, tests des formules.
2. **Comptes et sauvegarde** : inscription, connexion, choix de la classe, sauvegarde serveur, mode debug (console + panneau admin).
3. **Village** : page du village, panneaux des bâtiments, production idle, entrepôt, améliorations avec coûts, barre de ressources, infobulles.
4. **Combat solo et tour** :
   - moteur de combat dans `shared` (initiative de camp, 3 actions, recharges, éléments, altérations) ;
   - étages normaux, boss et dragon ;
   - progression, défaite, mode auto et vitesse.
5. **Équipement et butin** : inventaire, équipement, butin, Atelier (amélioration, fabrication), infobulles et comparaison.
6. **Zones de chasse, taverne et équipe** : farm, boutique avec renouvellement horaire, achat des 2e et 3e personnages, partage d'XP.
7. **Compétences avancées** : déblocages par niveau et par élément, deck, Tour d'alchimie (fusions), Tour d'amélioration, héritage.
8. **Multijoueur** : salons, code, sélection du personnage, « Prêt », chat, minuteur, déconnexions, butin par joueur et affichage « qui a obtenu quoi ».
9. **Finitions** : animations, sons (optionnels), équilibrage, performances.

---

## 18. Points encore ouverts (me demander avant de trancher)

- **Atelier à l'étage 15** : comme dans le diagramme, on ne peut pas améliorer d'objet avant. Faut-il l'ouvrir dès le début ?
- **Héritage** : déclenchement et portée exacts (compte entier ou personnage), voir §13.
- **Progression d'un invité** en multi (§12).
- **Revente d'objets** au marchand : 20 % du prix boutique, proposition à valider.
- **Effets de la Tour d'alchimie** aux niveaux 2 à 5 : propositions à valider.
- **Charbon** : utilisé seulement comme matériau de construction des bâtiments.
- **Noms de monstres** à vérifier avant publication (références religieuses ou marques) : voir le Guide du bestiaire.
