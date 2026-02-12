# Pauses collaborateurs – Swisscom B2B

Application interne de visualisation et gestion des pauses en temps réel, conforme à la charte graphique Swisscom B2B.

## Fonctionnalités (MVP)

- **Authentification** : inscription et connexion par email + mot de passe
- **Gestion du statut** : chaque collaborateur peut « Commencer la pause » ou « Reprendre le travail »
- **Vue équipe** : tableau partagé avec nom, statut (couleur) et durée écoulée, mis à jour en temps réel
- **Règles métier** : passage automatique « En pause » (jaune) → « Pause prolongée » (rouge) après 15 minutes (paramétrable côté serveur)

## Démarrage

### Prérequis

- Node.js 18+

### Installation

```bash
cd pause-collaborateurs
npm install
cd client && npm install && cd ..
```

### Lancer l'application

- **Mode développement** (backend + frontend) :
  ```bash
  npm run dev
  ```
- Backend seul : `npm run server` (port 3001)
- Frontend seul : `npm run client` (port 5173, proxy vers API)

Ouvrir [http://localhost:5173](http://localhost:5173). Créer un compte via « S'inscrire » pour tester.

## Configuration

- **Seuil pause prolongée** : `server/config.js` → `PAUSE_PROLONGEE_MINUTES` (défaut : 15)
- **JWT** : en production, définir la variable d'environnement `JWT_SECRET`
- **Port API** : variable d'environnement `PORT` (défaut : 3001)

### Super-administrateur

Le rôle **super-administrateur** est attribué automatiquement et exclusivement par correspondance d'email :

| Variable d'environnement | Valeur par défaut |
|---|---|
| `SUPER_ADMIN_EMAIL` | `chupa.inc@protonmail.com` |

**Fonctionnement :**

1. Le super-administrateur se connecte comme n'importe quel utilisateur (email + mot de passe choisi à l'inscription).
2. À chaque inscription ou connexion, le serveur compare l'email du compte avec `SUPER_ADMIN_EMAIL`.
3. Si l'email correspond : le rôle `superadmin` est automatiquement attribué (et persisté en base).
4. Si l'email ne correspond pas : le rôle reste `user` (ou `admin` si promu par un administrateur).
5. Aucune logique spéciale de mot de passe n'existe pour le super-administrateur.
6. Le rôle `superadmin` ne peut pas être attribué ni retiré via l'interface ou l'API — il est déterminé uniquement par l'email.
7. L'email du super-administrateur ne peut pas être modifié via l'interface d'administration.

Pour changer le super-administrateur, modifier la variable `SUPER_ADMIN_EMAIL` côté serveur et redémarrer.

### Réinitialiser le mot de passe super-admin (dev)

Si vous avez oublié le mot de passe du compte super-administrateur, utilisez le script CLI :

```bash
node server/scripts/resetSuperAdminPassword.js "NouveauMotDePasse123!"
```

- Le script cherche l'utilisateur correspondant à `SUPER_ADMIN_EMAIL` dans la base SQLite.
- Le nouveau mot de passe est haché (bcrypt, 10 rounds) — identique au processus d'inscription.
- Si le compte n'existe pas encore, le script affiche les instructions pour s'inscrire d'abord.
- **Aucun mot de passe en clair n'est stocké.**
- Le mot de passe doit faire au minimum 8 caractères.

### Changement de mot de passe

Chaque utilisateur authentifié peut changer son propre mot de passe depuis la page **Mon compte** (`/account`).

- Le formulaire demande le mot de passe actuel, le nouveau mot de passe et sa confirmation.
- Validation côté client : longueur minimale de 8 caractères, correspondance des deux saisies.
- Validation côté serveur : vérification du mot de passe actuel avant toute modification.
- Le nouveau mot de passe est haché (bcrypt) côté serveur et stocké dans la base de données.
- Endpoint : `PATCH /api/auth/me/password`

### Suppression d'utilisateurs

La suppression d'utilisateurs est réservée aux administrateurs et au super-administrateur, avec des restrictions selon le rôle :

| Rôle | Portée de suppression |
|---|---|
| **Super-administrateur** | Peut supprimer n'importe quel utilisateur de n'importe quelle équipe |
| **Administrateur** | Peut supprimer uniquement les utilisateurs de sa propre équipe |
| **Utilisateur** | Ne peut supprimer personne |

**Règle de protection** : le compte du super-administrateur (`SUPER_ADMIN_EMAIL`) ne peut jamais être supprimé, quel que soit le demandeur.

Lors de la suppression d'un utilisateur, toutes ses données associées sont également supprimées (statut, historique de pauses).

- Endpoint : `DELETE /api/admin/users/:id`
- Un modal de confirmation est affiché dans l'interface avant toute suppression.

### Équipes et changement d'équipe

Les équipes suivantes sont créées automatiquement au démarrage du serveur :
- **DMC-MM1**
- **DMC-MM2**
- **DMC-MM3**

**Règles de changement d'équipe :**

| Rôle | Permission |
|---|---|
| **Super-administrateur** | Peut changer l'équipe de n'importe quel utilisateur |
| **Administrateur** | Ne peut **pas** changer l'équipe (réservé au super-admin) |
| **Utilisateur** | Ne peut pas changer d'équipe |

**Protection** : l'équipe du super-administrateur ne peut pas être modifiée par un tiers (seul le super-admin lui-même peut changer sa propre équipe).

Chaque changement d'équipe est tracé dans le journal d'audit (`TEAM_CHANGE`) avec l'ancienne et la nouvelle équipe.

- Endpoint : `PATCH /api/admin/users/:id/team` (body: `{ "teamId": <id> }`)
- UI : bouton « Changer d'équipe » dans la page Super-Admin, avec modal de confirmation.

### Journal d'audit

Toutes les actions administratives sensibles sont tracées dans un journal d'audit immutable (`audit_logs`).

**Actions enregistrées :**

| Action | Code | Détails |
|---|---|---|
| Suppression d'utilisateur | `USER_DELETE` | Email, rôle et équipe de la cible |
| Changement de rôle | `ROLE_CHANGE` | Ancien rôle → Nouveau rôle |
| Réinitialisation du compteur | `COUNTER_RESET` | Email et équipe de la cible |
| Changement d'équipe | `TEAM_CHANGE` | Ancienne équipe → Nouvelle équipe |

**Chaque entrée contient :**
- Qui a effectué l'action (email, rôle)
- Quelle action a été réalisée
- Sur quel utilisateur (email, équipe)
- Quand (horodatage serveur)
- Détails supplémentaires (métadonnées JSON)

**Qui peut consulter le journal :**

| Rôle | Portée |
|---|---|
| **Super-administrateur** | Tous les logs de toutes les équipes |
| **Administrateur** | Uniquement les logs dont la cible appartient à son équipe |
| **Utilisateur** | Aucun accès |

**Accès :** page `/audit` (lien disponible depuis les pages Admin et Super-Admin).

**Filtres disponibles :** période (aujourd'hui / 7 jours / 30 jours / tout), type d'action, recherche par email.

**Sécurité :** les logs sont générés exclusivement côté serveur, immutables (aucun endpoint de modification/suppression), et limités à 500 entrées par requête.

- Endpoint : `GET /api/admin/audit-logs`

## Charte graphique

- Bleu principal Swisscom B2B : `#001155`
- Statuts : Vert (au travail), Jaune (en pause), Rouge (pause prolongée)
- Typographie : Inter, interface épurée et lisible

## Stack

- **Backend** : Node.js, Express, SQLite (better-sqlite3), Socket.io, JWT
- **Frontend** : React 18, Vite, Socket.io-client
