# Symbiose

Symbiose est une plateforme interne d'assistants IA integree a WordPress.

Ce depot contient :
- un plugin WordPress PHP pour l'interface, l'authentification et l'integration intranet
- un backend Node.js pour les agents, le streaming SSE, le RAG documentaire, les quotas et les outils metier

## Vue d'ensemble

```text
Navigateur
  -> Shortcode WordPress [symbiose]
  -> JWT signe cote PHP
  -> API Node.js / Express
  -> Runner d'agent
  -> Provider LLM + tools + RAG
  -> Flux SSE vers le navigateur
```

Architecture en deux couches :

- plugin WordPress Symbiose : `symbiose.php`, `includes/`, `assets/`
- backend Node.js deploye separement : `vps-symbiose/`

Le backend ne maintient pas de session applicative propre : il fait confiance au JWT signe par WordPress et synchronise l'utilisateur dans PostgreSQL a chaque requete.

## Structure du repo

```text
symbiose/
├── symbiose.php
├── README.md
├── CLAUDE.md
├── includes/
│   ├── class-admin.php
│   ├── class-jwt.php
│   └── class-shortcode.php
├── assets/
│   ├── chat.js
│   ├── chat.css
│   ├── marked.min.js
│   ├── admin/
│   │   ├── admin-stats.css
│   │   └── admin-stats.js
│   └── js/
│       ├── agent-picker.js
│       ├── conversations.js
│       ├── documents.js
│       ├── export.js
│       ├── messaging.js
│       ├── mic.js
│       ├── render.js
│       ├── slash-menu.js
│       ├── state.js
│       └── workflow.js
└── vps-symbiose/
    ├── package.json
    ├── .env.example
    └── src/
        ├── server.js
        ├── errors.js
        ├── agents/
        ├── api/
        ├── config/
        ├── db/
        ├── llm/
        ├── memory/
        ├── middleware/
        ├── prompts/
        ├── quota/
        ├── skills/
        ├── tools/
        └── utils/
```

## Cote WordPress

Fichiers principaux :

- `symbiose.php` : point d'entree du plugin Symbiose
- `includes/class-shortcode.php` : shortcode `[symbiose]`, chargement des assets et injection des donnees JWT/backend via le DOM
- `includes/class-jwt.php` : signature HS256 du JWT sans dependance externe
- `includes/class-admin.php` : page de configuration et page de statistiques

Le shortcode :

- verifie que l'utilisateur est connecte
- verifie que son role WordPress est autorise
- recupere `symbiose_backend_url` et `symbiose_jwt_secret`
- genere un JWT avec `wp_user_id`, `wp_roles`, `display_name`, `email`, `is_admin`, `aud`
- charge `assets/chat.js` en `type="module"`

Le frontend est scope sous `#symbiose-app` pour limiter les collisions CSS avec le theme WordPress.

## Cote backend Node.js

Point d'entree : `vps-symbiose/src/server.js`

Composants principaux :

- `api/` : endpoints REST et flux SSE
- `middleware/auth.js` : verification JWT et upsert utilisateur
- `agents/registry.js` : chargement dynamique des agents
- `agents/runner.js` : boucle agentique, execution d'outils, streaming SSE
- `llm/` : abstraction multi-provider
- `prompts/system-prompt.builder.js` : assemblage du system prompt
- `memory/session-memory.js` : historique, documents de conversation, compaction
- `memory/document-library.js` : OCR, resumes, chunking, embeddings, deduplication
- `quota/` : limites messages, tokens et couts
- `tools/` : outils exposes aux agents

Providers supportes :

- `mistral` : provider principal pour la plupart des agents
- `openai` : utilise notamment par `social-media`
- `anthropic` : adaptateur present, sans agent actif a ce jour

## Demarrage local

### Prerequis

- WordPress avec ce plugin active
- Node.js 20+
- PostgreSQL
- extension `pgvector` cote PostgreSQL
- au moins une cle API LLM parmi `MISTRAL_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- acces SQL Server seulement si tu utilises les agents Cifacil

### Variables d'environnement

Le backend charge actuellement les variables depuis un chemin absolu :

- `/home/quentin/projets/.env` dans `vps-symbiose/src/server.js`
- `/home/quentin/projets/.env` dans `vps-symbiose/src/db/migrate.js`

Le fichier `vps-symbiose/.env.example` sert donc de template, mais n'est pas lu automatiquement tant que ce chemin n'est pas modifie dans le code.

Variables importantes :

```env
PORT=3000
NODE_ENV=development
DEBUG_SSE=true

DATABASE_URL=postgresql://user:pass@localhost:5432/db
JWT_SECRET=<secret partage avec WordPress>
BACKEND_URL=https://backend.exemple.tld
ALLOWED_ORIGINS=https://intranet.exemple.tld

MISTRAL_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

CIFACIL_DB_SERVER=
CIFACIL_DB_DATABASE=
CIFACIL_DB_USER=
CIFACIL_DB_PASSWORD=
```

### Installation et lancement

Toutes les commandes backend se lancent depuis `vps-symbiose/`.

```bash
npm install
npm run migrate
npm run dev
```

Scripts disponibles :

- `npm start` : demarrage simple
- `npm run dev` : demarrage avec `node --watch`
- `npm run migrate` : application des migrations SQL

Configuration WordPress minimale :

1. activer le plugin
2. renseigner `symbiose_backend_url`
3. renseigner `symbiose_jwt_secret`
4. autoriser les roles WordPress voulus
5. inserer le shortcode `[symbiose]` sur une page

## Frontend

Le frontend n'est plus un script monolithique. `assets/chat.js` est le point d'entree ES module et orchestre les modules de `assets/js/`.

Responsabilites principales :

- `assets/chat.js` : bootstrap global, wiring des modules, orchestration generale
- `assets/js/messaging.js` : pipeline SSE, rendu des bulles, etats d'outils, reprise de stream
- `assets/js/conversations.js` : liste, selection, renommage, favoris, suppression
- `assets/js/agent-picker.js` : selecteur d'agents par groupes, favoris et recherche
- `assets/js/workflow.js` : UI guidee avant premier appel LLM
- `assets/js/documents.js` : panneau documents, upload, toggle `inject_full`
- `assets/js/render.js` : rendu Markdown, Mermaid, KaTeX et contenu assistant
- `assets/js/export.js` : export et copie
- `assets/js/mic.js` : speech-to-text
- `assets/js/state.js` : etat partage

Fonctionnalites visibles cote UI :

- streaming SSE en temps reel
- reprise d'un stream apres refresh
- bouton stop sur une generation en cours
- rendu Markdown
- rendu Mermaid
- rendu KaTeX
- sanitization via DOMPurify
- panneau conversations avec favoris
- selecteur d'agents groupe
- panneau documents de conversation
- upload de documents
- toggle `inject_full` par document
- quota et jauge de contexte
- menu `/` pour `forceTool` et `forceSkill`
- workflows guides pour certains agents

## Agents disponibles

Chaque agent est defini par un fichier `vps-symbiose/src/agents/definitions/<id>.agent.js`.

Shape attendu :

```js
export default {
  id: 'mon-agent',
  name: 'Nom affiche',
  description: '...',
  group: 'Groupe optionnel',
  systemPrompt: `...`,
  skills: ['rag-search'],
  tools: ['search-documents'],
  workflow: null, // optionnel
  config: {
    provider: 'mistral',
    model: 'mistral-large-latest',
    contextWindow: 256_000,
    temperature: 0.2
  }
}
```

Etat actuel du registry :

| ID | Nom | Groupe | Provider / modele | Workflow |
|----|-----|--------|-------------------|----------|
| `assistant` | Assistant general | - | `mistral` / `mistral-large-latest` | non |
| `hr-recruiter` | Assistant RH - Selection de candidats | `RH` | `mistral` / `mistral-large-latest` | non |
| `synthesis-note` | Note de synthese | `Cifacil / Professionnels` | `mistral` / `mistral-large-latest` | oui |
| `social-media` | Redacteur Reseaux Sociaux | `Reseaux sociaux` | `openai` / `gpt-5.4-mini` | non |
| `cifacil` | Cifacil - Analyse CRM | `Cifacil` | `mistral` / `mistral-large-latest` | non |
| `cifacil-statement-review` | Cifacil - Analyse de releves de compte | `Cifacil / Particuliers` | `mistral` / `mistral-large-latest` | oui |

Notes :

- les agents sont charges dynamiquement au demarrage
- `registry.js` enrichit les agents avec les titres de tools et les descriptions de skills
- `listAgents()` expose aussi `group`, `provider`, `model` et `workflow` au frontend

## Workflows

Un workflow est une UI guidee qu'on greffe sur un agent pour structurer le debut de la conversation. Au lieu d'un champ libre, l'utilisateur repond a des questions et ou uploade des fichiers avant le premier appel LLM.

Comportement actuel :

- `workflowMode: true` est envoye au premier appel
- `workflow_step` et `workflow_answers` sont persistes sur la conversation
- les etapes masquees via `showIf` sont ignorees dans la validation
- le frontend construit un `userMessage` structure a partir des reponses collectees
- apres le premier tour, la conversation redevient normale

Schema :

```js
workflow: {
  welcome: 'Texte introductif affiche dans le panel.',
  mode: 'steps', // ou 'form'
  steps: [
    {
      id: 'step-id',
      type: 'questions', // ou 'upload'
      title: 'Titre',
      showIf: { question: 'type', in: ['A', 'B'] }, // optionnel
      questions: [
        { id: 'q1', type: 'radio', label: 'Label', required: true, options: ['A', 'B'] },
        { id: 'q2', type: 'checkbox', label: 'Label', options: ['A', 'B'] },
        { id: 'q3', type: 'text', label: 'Label', placeholder: 'Ex : ...' },
        { id: 'q4', type: 'number', label: 'Montant' },
        { id: 'q5', type: 'textarea', label: 'Contexte', rows: 4 }
      ]
    },
    {
      id: 'documents',
      type: 'upload',
      title: 'Documents',
      hint: 'Texte d'aide',
      required: false
    }
  ],
  trigger: {
    label: 'Lancer la generation',
    message: 'Instruction envoyee au LLM apres collecte.'
  }
}
```

Agents qui utilisent deja un workflow :

- `synthesis-note`
- `cifacil-statement-review`

## Skills

Les skills vivent dans `vps-symbiose/src/skills/<id>/SKILL.md`.

Skills presents :

- `rag-search`
- `mermaid`
- `browse-web`
- `cifacil`

Fonctionnement :

- le system prompt n'injecte par defaut que les metadonnees des skills
- l'agent peut charger le contenu complet d'un skill a la demande
- le frontend peut forcer l'injection d'un skill via `forceSkill`

## Tools

Tools presents dans `vps-symbiose/src/tools/` :

| Fichier | Nom LLM | Role |
|---------|---------|------|
| `search-documents.tool.js` | `search_documents` | Recherche semantique dans les documents lies a la conversation |
| `browse-web.tool.js` | `browse_web` | Chargement et extraction simple de contenu web |
| `cifacil-query.tool.js` | `cifacil_query` | Requetes agregees sur le CRM Cifacil |
| `fetch-cifacil-documents.tool.js` | `fetch_cifacil_documents` | Recuperation et rattachement de documents depuis Cifacil |
| `get-skill-content.tool.js` | `get_skill_content` | Chargement lazy du contenu des skills |

Conventions :

- nom de fichier en kebab-case
- export nomme de type `searchDocumentsTool`
- `conversationId`, `userEmail` et `userRoles` sont injectes cote serveur

## API principale

### Sante

- `GET /api/health`

### Agents

- `GET /api/agents`
- `GET /api/agents/favorites`
- `POST /api/conversations/:conversationId/agents/:agentId/run`

Body principal pour `run` :

```json
{
  "message": "Texte utilisateur",
  "forceTool": "search-documents",
  "forceSkill": "rag-search",
  "workflowMode": true,
  "forcedDocIds": [12, 13]
}
```

### Conversations

- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `GET /api/conversations/:id/documents`
- `GET /api/conversations/:conversationId/rejoin-stream`
- `POST /api/conversations`
- `POST /api/conversations/:conversationId/stop`
- `PATCH /api/conversations/:id`
- `PATCH /api/conversations/:id/documents/:docId`
- `DELETE /api/conversations/:id`

### Documents

- `POST /api/conversations/:conversationId/documents/upload`
- `POST /api/conversations/:conversationId/documents/:documentId`
- `GET /api/users/:userId/documents`
- `GET /api/conversations/:conversationId/context-budget?agentId=<id>`

### Utilisateur courant

- `GET /api/me/quota`

### Admin

- `GET /api/admin/users`
- `GET /api/admin/stats`
- `GET /api/admin/model-pricing`
- `PUT /api/admin/model-pricing/:model`
- `DELETE /api/admin/model-pricing/:model`

## Streaming SSE

Le runner `vps-symbiose/src/agents/runner.js` prend la main sur la reponse HTTP et renvoie un flux SSE.

Evenements emis :

- `chunk`
- `tool_start`
- `tool_result`
- `done`
- `error`
- `debug` si `DEBUG_SSE=true`

Boucle d'execution :

```text
appel LLM
-> emission des tokens
-> detection de tool calls
-> execution des tools
-> reinjection des resultats
-> nouvel appel LLM
-> stop quand la reponse est finalisee ou MAX_ITERATIONS atteint
```

`MAX_ITERATIONS` vaut actuellement `10`.

## Authentification

Flux d'auth :

1. WordPress genere un JWT HS256
2. le frontend l'envoie dans `Authorization: Bearer <token>`
3. `authMiddleware` verifie la signature et l'audience
4. l'utilisateur est insere ou mis a jour dans la table `users`

Champs attendus dans le token :

- `wp_user_id`
- `wp_roles`
- `display_name`
- `email`
- `is_admin`
- `aud`

L'audience attendue cote Node est `process.env.BACKEND_URL`, sinon `symbiose-backend`.

Les roles WordPress sont utilises en temps reel depuis le JWT (`wp_roles`) et ne sont plus persistes dans PostgreSQL.

## Base de donnees

### PostgreSQL

Tables principales :

```text
users
conversations
messages
documents
document_chunks
conversation_documents
quota_config
quota_usage
schema_migrations
tool_usages
skill_usages
model_pricing
system_usages
```

Usages principaux :

- `users` : projection des utilisateurs WordPress, sans persistance des roles
- `conversations` : meta conversation, agent, modele, favoris, suppression logique, etat de stream, workflow
- `messages` : historique des tours et tokens
- `documents` : OCR, resume, hash de deduplication
- `document_chunks` : chunks et embeddings pgvector
- `conversation_documents` : liaison conversation document et flag `inject_full`

### SQL Server / Cifacil

Le tool `cifacil_query` expose uniquement des requetes agregees.
Les non-admins sont filtres sur leurs propres dossiers.

## Pipeline document

Pipeline actuel :

```text
upload
-> hash SHA-256
-> deduplication par utilisateur
-> OCR Mistral
-> resume global
-> chunking
-> embeddings Mistral
-> insertion PostgreSQL
-> liaison a la conversation
```

Formats acceptes :

- PDF
- JPEG
- PNG
- WebP

Limites actuelles :

- 10 Mo max par fichier
- 100 pages max par document
- 10 documents max par conversation

Comportement d'injection dans le system prompt :

- skills : metadonnees seulement, sauf `forceSkill`
- documents avec `inject_full = true` : resume plus texte OCR complet
- documents avec `inject_full = false` : resume seulement, l'agent doit utiliser `search_documents`
- si `workflowMode = true` : tous les documents sont traites comme `inject_full`
- si les documents depassent le budget contexte, le backend peut demander une selection explicite via `forcedDocIds`

### Depassement de contexte

Le projet gere separement :

- l'historique de conversation
- les documents injectes dans le prompt

#### Historique trop long

Le backend ne renvoie pas tout l'historique brut au modele.

- `buildSystemPrompt()` calcule un budget disponible pour l'historique apres reservation du prompt systeme, des documents et d'une marge pour la reponse du modele
- `getHistory()` recharge seulement les messages les plus recents qui tiennent dans ce budget
- si une compaction existe, un resume des anciens echanges est reinjecte avant les messages recents
- quand l'historique devient trop long, une compaction est declenchee en tache de fond pour condenser les anciens tours

Effet utilisateur :

- pas de message d'erreur
- les anciens echanges restent exploitables via resume
- seuls les tours les plus recents restent presents en verbatim dans le contexte LLM

#### Documents trop volumineux

Quand les documents demandes en contexte complet depassent la fenetre disponible :

- le backend n'appelle pas le LLM tout de suite
- il emet un evenement SSE `context_overflow`
- le frontend affiche une carte de selection des documents avec estimation de tokens et jauge de budget
- les documents trop gros pour tenir seuls sont marques `Trop volumineux — RAG uniquement`
- l'utilisateur choisit quels documents injecter en texte integral
- le message est relance avec `forcedDocIds`
- les documents non selectionnes restent accessibles via `search_documents`

Il existe aussi un filet de securite :

- si le provider LLM retourne malgre tout une erreur de type `context too large`, le runner reconvertit cette erreur en `context_overflow` et redemande une selection utilisateur

Important :

- la selection `forcedDocIds` ne vaut que pour le tour en cours
- a la fin d'une generation terminee, le backend remet les `inject_full` a `false`

## Quotas et analytics

Le projet suit notamment :

- nombre de messages par jour
- tokens utilises par jour
- tokens utilises par mois
- usages des tools
- usages des skills
- cout estime par modele
- usages systeme OCR, embeddings, resumes et compaction

Le frontend affiche deja :

- quota messages
- cout journalier et ses bornes semaine mois
- jauge d'occupation du contexte

Une page admin WordPress permet aussi de consulter les statistiques et la table de pricing modele.
