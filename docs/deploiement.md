# Mettre Petit Cortège en ligne sur un VPS

Guide pas à pas, pour quelqu'un qui n'a jamais déployé de site. Il suit l'ordre réel : domaine, DNS, sécurisation du VPS, installation, textes légaux, construction, première manif, jour J, sauvegardes.

Tout vient du dossier [`deploiement/`](../deploiement/) : `installer.sh`, `mettre-a-jour.sh`, `Caddyfile`, `petit-cortege.service`, `petit-cortege.env.exemple`, `sauvegarde.sh` (+ minuterie), `moderation.sh`, `import-manifs.sh`. Les scripts sont commentés : les lire est la meilleure façon de comprendre ce qu'ils font.

> **État de validation (à lire).** Ce qui a été essayé pour de vrai, en local : la construction du client, le serveur de production lancé comme le fera systemd avec un fichier d'environnement issu de l'exemple, la création et la modération d'une manif, la sauvegarde et la restauration, le `Caddyfile` (validé et exercé en HTTP avec Caddy 2.6.2, sans TLS) et l'app complète dans un vrai Chrome derrière les en-têtes du `Caddyfile`. **Pas essayé** : `installer.sh` sur un VPS vierge, l'émission du certificat Let's Encrypt, l'unité systemd chargée par systemd (seulement `systemd-analyze verify`), la dernière version de Caddy. Si une étape échoue chez toi, c'est probablement là : lis le message, puis la section « En cas de problème ».

> **Production (15 novembre 2026).** https://petit-cortege.fr tourne sur un VPS OVH à Strasbourg (Ubuntu 24.04). Nginx est le reverse proxy. Les fichiers statiques et publiés sont servis par ce VPS, sans CDN et sans Caddy. Les scripts de ce dossier installent encore Caddy : ils décrivent une autre façon de mettre en ligne, pas la machine actuelle. Les pages légales décrivent cet hébergement (ADR 0005).

## Ce que tu mets en place

```
Internet ──► Caddy (HTTPS, ports 80/443)
               ├─ /            site compilé (client/dist)
               ├─ /decors/*    décors des manifs (dans client/dist)
               ├─ /publie/*    fichiers publiés, lus directement sur le disque
               └─ /api/*  ───► serveur Node (127.0.0.1:8787, jamais exposé)
                                  └─ Postgres (127.0.0.1:5432, jamais exposé)
```

Un seul serveur, trois programmes (Caddy, Node, Postgres), environ 10 €/mois d'hébergement selon le fournisseur (ADR 0005).

## 0. Ce qu'il faut avoir ou acheter

### Un VPS

Un serveur virtuel sous **Debian 12 ou Ubuntu 24.04**, avec un accès `root` en SSH et une adresse IPv4 (IPv6 en plus si possible), dans l'Union européenne. La production est un VPS OVH à Strasbourg (ADR 0005) ; un autre hébergeur convient, voir l'étape 4 pour adapter les textes légaux. Note, dans la console de l'hébergeur : l'**adresse IP** du serveur, et le **lieu** du centre de données (il sert aux mentions légales).

Pour un premier test, la plus petite offre suffit largement. Pour une vraie journée de mobilisation, voir « Charge attendue » à l'étape 7.

### Un nom de domaine

- **Où l'acheter** : chez un bureau d'enregistrement (« registrar ») établi dans l'Union européenne, pour rester cohérent avec le reste du projet. Par exemple OVHcloud ou Gandi (non exhaustif, vérifie toi-même les conditions du moment).
- **Quel prix** : il varie beaucoup selon l'extension (`.fr`, `.org`, `.eu`, etc.), de quelques euros à quelques dizaines d'euros par an. Regarde le prix du **renouvellement**, souvent plus élevé que celui de la première année. Je ne donne pas de tarif : je ne peux pas le vérifier.
- **Masquage WHOIS** : à l'achat, vérifie que tes nom, adresse et e-mail ne seront pas publics dans l'annuaire WHOIS. Beaucoup de registrars l'activent par défaut pour les particuliers ou le proposent gratuitement ; sinon, active l'option. Le registrar, lui, connaît ton identité.
- **Un sous-domaine d'un domaine que tu as déjà** (`cortege.<ton-domaine>`) marche tout aussi bien et évite un achat.

### Rappel LCEN : qui connaît ton identité

Le projet est édité par un particulier, sous pseudonyme, à titre non professionnel. La loi (LCEN, art. 6) l'autorise à rester anonyme du public **à condition d'avoir communiqué son identité à l'hébergeur**. Concrètement : tu donnes ton vrai nom et ton adresse au fournisseur du VPS (et au registrar), qui ne les transmet qu'à l'autorité judiciaire. Les pages légales du site le disent déjà. Ne mens pas à l'inscription : c'est ce qui rend le pseudonymat légal.

### Il n'y a rien à créer chez Supabase

Tu as peut-être lu qu'il faut « mettre en place Supabase ». Ce n'était pas faux au début du projet, mais l'**ADR 0005** a tranché autrement : **Postgres + un petit serveur Node, tous deux sur ton VPS**. La raison : il n'y a pas de temps réel (ADR 0004), donc Supabase n'apporterait plus grand-chose, alors que le projet repose sur la maîtrise des journaux (ADR 0002) : sur ton propre serveur, tu décides ce qui est enregistré et pour combien de temps. Postgres s'installe donc sur le VPS (le script s'en charge) : **pas de compte Supabase, pas de clé, rien à configurer là-bas.**

### Pas de CDN

L'ADR 0005 sert les fichiers statiques et publiés depuis le VPS. C'est le cas de https://petit-cortege.fr, et c'est aussi ce que fait ce guide. La section 9 reste une piste, non utilisée, si l'on voulait un jour un CDN.

## 1. DNS : pointer le domaine vers le VPS

Chez ton registrar (« zone DNS » ou « enregistrements DNS »), crée :

| Type | Nom | Valeur |
|------|-----|--------|
| `A` | `@` (ou le sous-domaine choisi) | `<ip-v4-du-vps>` |
| `AAAA` | `@` (ou le sous-domaine) | `<ip-v6-du-vps>` (seulement si ton VPS a une IPv6) |

Si tu n'es pas sûr que l'IPv6 du VPS fonctionne, **ne crée pas** d'enregistrement `AAAA` : un `AAAA` qui ne répond pas fait échouer l'émission du certificat HTTPS.

Vérifie depuis ton ordinateur :

```sh
dig +short A <ton-domaine>
```

```sh
dig +short AAAA <ton-domaine>
```

La réponse doit être l'adresse de ton VPS. La propagation prend de quelques minutes à quelques heures (la durée de vie, « TTL », de l'ancien enregistrement compte). **Attends que `dig` réponde juste avant de passer à l'étape 3** : Caddy demande son certificat à Let's Encrypt au premier démarrage, et des échecs répétés te bloquent temporairement (limites de Let's Encrypt).

## 2. Sécuriser le VPS

Connecte-toi en `root` (adresse et mot de passe ou clé fournis par l'hébergeur) :

```sh
ssh root@<ip-du-vps>
```

Mises à jour du système :

```sh
apt-get update && apt-get -y upgrade
```

Fuseau horaire (les heures des journaux, de la sauvegarde nocturne… sont celles du serveur ; la modération, elle, lit les heures sans fuseau comme des heures de Paris dans tous les cas) :

```sh
timedatectl set-timezone Europe/Paris
```

Un utilisateur d'administration, pour ne plus travailler en `root` :

```sh
adduser <ton-utilisateur>
```

```sh
usermod -aG sudo <ton-utilisateur>
```

Sur **ton ordinateur**, crée une clé SSH si tu n'en as pas, puis envoie-la au serveur :

```sh
ssh-keygen -t ed25519
```

```sh
ssh-copy-id <ton-utilisateur>@<ip-du-vps>
```

**Ouvre une deuxième fenêtre** et vérifie que `ssh <ton-utilisateur>@<ip-du-vps>` fonctionne **avec la clé** et que `sudo -v` marche. Seulement ensuite, coupe la connexion SSH par mot de passe et la connexion directe en `root` :

```sh
sudo tee /etc/ssh/sshd_config.d/10-durcissement.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
EOF
```

```sh
sudo systemctl reload ssh
```

Pare-feu : on n'ouvre que SSH (22), HTTP (80, utile à Let's Encrypt et à la redirection vers HTTPS) et HTTPS (443). Postgres et le serveur Node n'écoutent que sur `127.0.0.1` et ne sont de toute façon pas joignables de l'extérieur.

```sh
sudo apt-get install -y ufw
```

```sh
sudo ufw default deny incoming && sudo ufw default allow outgoing
```

```sh
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443
```

```sh
sudo ufw logging off
```

(La dernière commande évite que le pare-feu écrive dans le journal les adresses IP des paquets refusés : tu promets aux visiteurs qu'aucune IP n'est journalisée, autant ne pas t'en écarter.)

```sh
sudo ufw enable
```

Vérifie que seuls SSH, HTTP et HTTPS répondent, et que Postgres n'est pas exposé (après l'installation, à l'étape 3, le résultat doit montrer `127.0.0.1:5432` et `127.0.0.1:8787`, jamais `0.0.0.0` pour ces deux ports) :

```sh
sudo ss -tlnp
```

Facultatif mais conseillé : les mises à jour de sécurité automatiques.

```sh
sudo apt-get install -y unattended-upgrades
```

À partir d'ici, travaille avec `<ton-utilisateur>` et `sudo`.

## 3. Installer

### Récupérer le code

Le code est dans `/opt/petit-cortege`. Clone le dépôt (d'après `CLAUDE.md`, il est sur `github.com/Kevw94/petit-cortege` ; remplace l'adresse si tu travailles sur ton propre dépôt) :

```sh
sudo apt-get install -y git
```

```sh
sudo git clone https://github.com/Kevw94/petit-cortege.git /opt/petit-cortege
```

- **Dépôt privé** : le clonage par HTTPS demandera un identifiant. Le plus simple est une « deploy key » (clé en lecture seule) générée sur le VPS avec `ssh-keygen`, ajoutée dans les réglages du dépôt sur GitHub, puis un clonage avec l'adresse SSH (`git@github.com:…`).
- **Sans passer par GitHub** : copie le dossier depuis ton ordinateur (`rsync -a --exclude node_modules --exclude .git ./ <ton-utilisateur>@<ip-du-vps>:/tmp/petit-cortege/`, puis `sudo mv /tmp/petit-cortege /opt/petit-cortege`). Le script d'installation fonctionne aussi dans ce cas, mais `mettre-a-jour.sh` (qui utilise `git pull`) ne marchera pas : tu refais un `rsync` à chaque mise à jour, puis `sudo bash /opt/petit-cortege/deploiement/mettre-a-jour.sh --sans-pull`.

### Lancer l'installation

```sh
sudo DOMAINE=<ton-domaine> bash /opt/petit-cortege/deploiement/installer.sh
```

Le script est **idempotent** (tu peux le relancer) et il ne supprime rien. Il installe Node 22, Postgres 16 et Caddy ; crée l'utilisateur système `petit-cortege` ; crée `/etc/petit-cortege.env` avec **des secrets tirés au hasard** (ils ne sont affichés nulle part et ne sont dans aucun dépôt) ; crée le rôle et la base Postgres ; installe Caddy, le service, la sauvegarde nocturne et la commande `pc-moderation`.

**Il s'arrête volontairement avant de construire le site** tant que `client/src/pages/a-completer.ts` contient des marqueurs `[À COMPLÉTER…]`. C'est le comportement normal à la première exécution : passe à l'étape 4, puis relance la même commande.

Pour savoir tout ce qu'il fait, ou le faire à la main, lis `deploiement/installer.sh` : chaque étape est numérotée et commentée.

### Le fichier d'environnement

Il est dans `/etc/petit-cortege.env` (droits `0640`, lisible par root et par le service seulement). Pour voir les noms des variables sans afficher les secrets :

```sh
sudo sed 's/=.*/=…/' /etc/petit-cortege.env | grep -v '^#' | grep .
```

Les valeurs par défaut conviennent pour un premier lancement. Chaque variable est expliquée dans [`deploiement/petit-cortege.env.exemple`](../deploiement/petit-cortege.env.exemple). Les trois qui comptent :

- `PROXYS_DE_CONFIANCE=127.0.0.1,::1` : le serveur Node est derrière Caddy, qui lui transmet l'adresse du visiteur dans `X-Forwarded-For`. Sans cette ligne, tous les visiteurs partageraient la même limite par IP (celle de `127.0.0.1`). Le serveur refuse de démarrer sans elle.
- `ALTCHA_CLE_HMAC` : la clé qui signe les défis anti-triche. Ne la change pas pendant une manif.
- `LIMITE_ENTREES_PAR_IP` (60 par minute et par IP, par défaut) et `PLAFOND_ENTREES_GLOBAL` (1 000 entrées par minute avant alerte) : voir l'étape 7.

Pour modifier le fichier, puis appliquer :

```sh
sudo nano /etc/petit-cortege.env
```

```sh
sudo systemctl restart petit-cortege
```

Si tu as perdu ou voulu changer le mot de passe Postgres : change-le dans la base **et** dans `DATABASE_URL` :

```sh
sudo -u postgres psql -c "alter role petit_cortege password '<nouveau-mot-de-passe-hexadecimal>'"
```

(Génère-le avec `openssl rand -hex 24`.)

## 4. Remplir les textes légaux (avant de construire)

Le fichier [`client/src/pages/a-completer.ts`](../client/src/pages/a-completer.ts) est le **seul** à remplir. Tant qu'une valeur commence par `[À COMPLÉTER`, elle s'affiche telle quelle, en surbrillance, sur les pages Mentions légales, Vie privée, Charte et CGU. Les scripts `installer.sh` et `mettre-a-jour.sh` refusent de construire dans ce cas.

Le plus propre : **modifie ce fichier sur ton ordinateur, commite, pousse**, puis clone (ou `git pull`) sur le VPS. Ainsi le VPS ne contient aucune modification locale et `mettre-a-jour.sh` n'est jamais gêné. Si tu préfères éditer sur le VPS (`sudo nano /opt/petit-cortege/client/src/pages/a-completer.ts`), commite-le sur place, sinon `mettre-a-jour.sh` refusera de continuer (il ne met pas à jour par-dessus des modifications non commitées).

Le fichier commité décrit https://petit-cortege.fr (OVH, Strasbourg, sans CDN). Si tu déploies ailleurs, change les valeurs, puis les phrases de `pages-legales.ts` qui nomment OVH.

| Champ | Quoi mettre |
|-------|-------------|
| `pseudo` | Ton pseudonyme d'éditeur (aussi directeur de la publication). En production : `kevw94`. |
| `emailSignalement` | Une adresse e-mail dédiée, **que tu lis vraiment** : c'est elle qui reçoit les signalements de contenus (obligation LCEN de retrait « prompt »). En production : `contact@petit-cortege.fr`. |
| `coordonneesHebergeur` | Raison sociale, adresse postale et identifiants **de ton hébergeur de VPS**, recopiés depuis ses mentions légales. Ne les devine pas. En production : OVH SAS, d'après https://www.ovhcloud.com/fr/terms-and-conditions/ (pas de téléphone sur cette page). |
| `centreDeDonnees` | La ville et le pays du centre de données, indiqués dans la console du fournisseur. En production : « Strasbourg (SBG), France ». |
| `critereAmpleur` | Une phrase qui complète « nous ajoutons une manif quand… », sur l'**ampleur** et jamais sur la cause (ADR 0003). |
| `dureeSauvegardes` | Mets **`7 jours`** : c'est `DUREE_JOURS=7` dans `deploiement/sauvegarde.sh` (voir l'étape 8). Si tu changes l'un, change l'autre. Pense que les sauvegardes peuvent contenir des hachages de jetons de retrait (ADR 0001). |
| `licenceCode` | La licence du code et le lien vers le dépôt, ou « code non publié ». En production : licence MIT et https://github.com/Kevw94/petit-cortege. |
| `dateMiseAJour` | Date du jour, ex. « 16 novembre 2026 ». |

### Si l'hébergeur ou le lieu change

[`pages-legales.ts`](../client/src/pages/pages-legales.ts) nomme OVH, la France et Strasbourg, et dit que les fichiers sont servis depuis le même serveur. Changer seulement `a-completer.ts` ne suffit pas. À relire :

1. **Mentions légales, « Hébergement »** : le nom OVH et « société française » sont dans la phrase, les coordonnées et le centre de données viennent de `a-completer.ts`.
2. **Vie privée, « Journaux techniques »** : pas de CDN. Le programme qui reçoit les entrées n'enregistre pas d'adresse IP ; la page ne décrit pas les journaux d'accès de Nginx, absents de ce dépôt.
3. **Vie privée, « Mesure d’audience »** : Umami auto-hébergé sur le même serveur (`stats.petit-cortege.fr`), sans cookie et sans IP stockée. Si tu n'actives pas la mesure, réécris ce paragraphe : il décrit le site en production.
4. **Vie privée, « Hébergement en France et Cloud Act »** : OVH, société française, fichiers sur le même serveur. Ne pas affirmer que l'hébergeur échappe au Cloud Act sans source vérifiable.
5. **Test** : `client/src/pages/pages-legales.test.ts` vérifie OVH, Strasbourg, Umami, l'absence de « Hetzner », « Bunny » et « CDN ». Adapte-le, sinon `npm test` échouera. Lance ensuite :

```sh
npm test -- client/src/pages
```

Après modification, relis les quatre pages dans le navigateur (`https://<ton-domaine>/#/mentions-legales`, `#/vie-privee`, `#/charte`, `#/cgu`).

Enfin, relance l'installation (elle construit le site, maintenant que les marqueurs ont disparu) :

```sh
sudo DOMAINE=<ton-domaine> bash /opt/petit-cortege/deploiement/installer.sh
```

## 5. Construire, lancer, vérifier

Si tu as relancé `installer.sh` à la fin de l'étape 4, tout est fait : il a lancé `npm ci --ignore-scripts` puis `npm run build` (résultat dans `/opt/petit-cortege/client/dist/` : `index.html`, `assets/` avec des noms à empreinte, `decors/`, `apercu.png`), puis démarré les services.

### Mesure d'audience (Umami)

Le client charge `https://stats.petit-cortege.fr/script.js` seulement pour un build de production, et seulement si la variable **`VITE_UMAMI_WEBSITE_ID`** contient l'UUID du site (réglages Umami). Elle est documentée dans [`client/.env.example`](../client/.env.example). Aucun identifiant n'est écrit dans le code. Si la variable est absente, vide, ou n'est pas un UUID, aucun script n'est inséré. Le script respecte le signal Do Not Track du navigateur.

Vite lit la variable **au build**, pas au lancement du serveur. Deux endroits, le premier gagne s'il est rempli :

1. Une ligne `VITE_UMAMI_WEBSITE_ID=<uuid>` dans `/etc/petit-cortege.env` (voir [`petit-cortege.env.exemple`](../deploiement/petit-cortege.env.exemple)). `installer.sh` et `mettre-a-jour.sh` la transmettent à `npm run build`. Le serveur Node l'ignore.
2. Sinon, le fichier `/opt/petit-cortege/client/.env.production` (non versionné ; le `.gitignore` l'ignore). Vite le lit tout seul.

Changer l'UUID, ou l'ajouter, demande une reconstruction (`mettre-a-jour.sh`), pas seulement `systemctl restart`. Le routage est un fragment (`#/…`) : le script Umami en place n'écoute que `history.pushState`, donc le client compte lui-même chaque `hashchange`. Le premier affichage est compté par le script, avec le fragment.

**Content-Security-Policy.** Le `Caddyfile` autorise `https://stats.petit-cortege.fr` en `script-src` et en `connect-src`, et rien d'autre. `mettre-a-jour.sh` recopie ce fichier vers `/etc/caddy/Caddyfile` quand Caddy est le reverse proxy. **La production utilise Nginx** (ADR 0005) : cette configuration n'est pas dans le dépôt, et les scripts ne la modifient pas. Il faut recopier l'en-tête à la main dans le vhost Nginx, puis recharger Nginx (`sudo nginx -t` puis `sudo systemctl reload nginx`). Sans ça, le navigateur bloque le script. L'en-tête à poser :

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://stats.petit-cortege.fr; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://stats.petit-cortege.fr; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Vérifie le service :

```sh
sudo systemctl status petit-cortege
```

Tu dois lire `active (running)`. Le journal :

```sh
sudo journalctl -u petit-cortege -n 30 --no-pager
```

Tu dois voir `Serveur prêt : http://127.0.0.1:8787` (et aucune adresse IP de visiteur : le serveur n'en écrit jamais). Caddy :

```sh
sudo systemctl status caddy
```

Les appels de contrôle (remplace le domaine) :

```sh
curl -s https://<ton-domaine>/api/defi
```

Réponse attendue : un JSON avec `parameters` et `signature`.

```sh
curl -si https://<ton-domaine>/publie/manifs.json
```

Réponse attendue : `HTTP/2 200`, `cache-control: public, max-age=30`, et un corps `{"v":1,…,"manifs":[]}` (vide tant que tu n'as pas ajouté de manif ; le serveur l'écrit dans les 5 secondes suivant son démarrage).

```sh
curl -sI https://<ton-domaine>/
```

Réponse attendue : `HTTP/2 200`, `cache-control: no-cache`, et les en-têtes de sécurité (`content-security-policy`, `strict-transport-security`…). Ouvre ensuite `https://<ton-domaine>` dans un navigateur : le cadenas HTTPS doit être valide et la liste des manifs s'afficher.

Vérifie que la limite par IP ne se laisse pas contourner par un faux en-tête (la route `/api/defi` accepte 120 requêtes par minute et par IP ; tu dois voir des `200` puis des `429`, même avec un `X-Forwarded-For` différent à chaque fois) :

```sh
for i in $(seq 1 130); do curl -s -o /dev/null -w "%{http_code} " -H "X-Forwarded-For: 10.0.0.$i" https://<ton-domaine>/api/defi; done; echo
```

(Attends une minute ensuite : ta propre IP est limitée pendant ce temps.)

Si le certificat n'est pas émis : `sudo journalctl -u caddy -n 50 --no-pager` (cherche `obtaining certificate`), et vérifie le DNS (étape 1) et le pare-feu (ports 80 et 443).

## 6. Ajouter les manifs du jour

Chaque manif est saisie à la main (ADR 0003 : sélection sur l'ampleur, jamais sur la cause). Deux chemins pour le parcours :

- **Outil d'import** `npm run import-manifs` : trace le parcours depuis des données ouvertes, à relire avant publication. Mode d'emploi complet dans [`docs/import-manifs.md`](import-manifs.md). En une phrase : **tracer → relire → décors → publier**. Les décors qu'il produit sont écrits dans `client/public/decors/` : après les avoir ajoutés (et commités), **reconstruis le client** pour qu'ils arrivent dans `client/dist/decors/` :

  ```sh
  sudo bash /opt/petit-cortege/deploiement/mettre-a-jour.sh
  ```

  (`--sans-pull` si tu as copié les fichiers sans passer par git.) Puis publie les manifs du jour avec la commande `pc-import-manifs`, qui s'exécute comme `pc-moderation` sous l'utilisateur du service, avec la base et le dossier de publication de production. « tracer » et « decors » se font sur ta machine, avant de committer ; sur le VPS, seule « publier » sert :

  ```sh
  sudo pc-import-manifs publier --fichier /opt/petit-cortege/donnees/manifs/2026-11-14.json
  ```

  Les manifs dont la vérification humaine n'est pas remplie dans le fichier du jour sont refusées (c'est voulu, ADR 0003).

- **À la main** : un tracé exporté depuis uMap au format GeoJSON, que tu envoies sur le VPS (par exemple dans `/opt/petit-cortege/donnees/`, lisible par le service).

La commande de modération s'appelle `pc-moderation` sur le serveur. Elle équivaut à `npm run moderation -- …` mais s'exécute sous l'utilisateur du service, avec l'environnement du service (base et dossier de publication de production). Aide :

```sh
sudo pc-moderation aide
```

Créer et publier une manif (l'heure sans fuseau est lue comme **heure de Paris** ; au moins une `--source` publique est obligatoire ; `--ouverture` facultatif, par défaut les entrées ouvrent tout de suite) :

```sh
sudo pc-moderation creer-manif --geojson /opt/petit-cortege/donnees/osm/republique-nation/parcours.geojson --intitule "Titre de la manif" --ville "Paris" --depart 2026-11-21T14:00 --source "Appel des organisateurs|https://exemple.org/appel"
```

Réponse : `Manif « paris-2026-11-21 » créée et publiée.` (l'identifiant est la ville et la date, ou `--id`.) Le GeoJSON de cet exemple est celui du dépôt (République → Nation) ; remplace-le par ton tracé. Lister :

```sh
sudo pc-moderation lister
```

Vérifie que la manif est publiée :

```sh
curl -s https://<ton-domaine>/publie/manifs.json | head -c 300
```

Ouvre le site : la manif apparaît dans la liste. Si son parcours n'est couvert par aucun décor, la vue s'affiche sans décor (c'est le rôle de `import-manifs` et de `docs/import-manifs.md`).

## 7. Le jour J

### Avant le départ

1. **Vérifie l'absence d'arrêté d'interdiction** (ADR 0003) : ils sont souvent pris la veille, regarde le site de la préfecture concernée et la presse juste avant le départ. Interdite par arrêté, décision de justice ou dissolution du groupe organisateur : retire la manif (ci-dessous). Rien d'autre ne justifie un retrait : on ne juge jamais la cause.
2. Ouvre le site comme un visiteur, sur un téléphone, et rejoins le cortège avec un appareil à toi : la preuve de travail dure quelques secondes.
3. `sudo systemctl status petit-cortege caddy` et `df -h` (espace disque).

### Pendant

Décaler un départ (retard annoncé par les organisateurs ; `--minutes` négatif pour avancer) :

```sh
sudo pc-moderation decaler-depart --manif paris-2026-11-21 --minutes 15
```

Ou à une heure précise :

```sh
sudo pc-moderation decaler-depart --manif paris-2026-11-21 --depart 2026-11-21T14:45
```

Retirer une manif de la liste (les entrées sont refusées, le retrait est publié) :

```sh
sudo pc-moderation retirer-manif --manif paris-2026-11-21 --motif "arrêté d'interdiction de la préfecture, référence …"
```

Supprimer un avatar signalé (il rejoint le fichier des retraits, que le client applique) : l'identifiant d'avatar est le champ `"a"` des fichiers d'entrées publiés. Pour le retrouver dans les fichiers (remplace la partie connue du signalement) :

```sh
sudo grep -l '<fragment-de-l-identifiant>' /var/lib/petit-cortege/publie/entrees/*.json
```

```sh
sudo pc-moderation supprimer-avatar --avatar <identifiant-de-l-avatar>
```

Un retrait de contenu manifestement illicite relève de ton obligation d'hébergeur (LCEN) : fais-le **promptement**, il n'a rien à voir avec un jugement sur la cause.

### Surveiller

Journal en direct (le serveur n'y écrit aucune IP) :

```sh
sudo journalctl -u petit-cortege -f
```

Ce que tu peux y lire : `Publication lente : … ms` (la tâche de publication dépasse son intervalle), `Publication en échec` (à investiguer), et `Petit Cortège : plus de 1000 entrées en 60 s (plafond global dépassé)` : alerte anti-triche, unique par minute dépassée ; les entrées ne sont pas bloquées. Un webhook d'alerte est possible (`ALERTE_WEBHOOK_URL`, voir l'exemple d'environnement).

Charge de la machine :

```sh
sudo apt-get install -y htop && htop
```

### Charge attendue

D'après [`docs/test-de-charge.md`](test-de-charge.md) : une manif simulée de 100 000 soutiens a tenu un pic d'environ 550 entrées par seconde, avec un processus Node à environ 25 % d'un cœur (p50) et 184 Mo de mémoire. **Ces mesures viennent d'un conteneur local à 4 cœurs, pas d'un VPS** : elles n'ont pas été rejouées en production, sans Caddy, sans TLS, sans CDN, et un essai a montré des latences 30 fois plus mauvaises sur une machine partagée. Le plafond d'alerte par défaut (1 000 entrées par minute) est **très inférieur** à ce pic simulé : si tu attends une grosse journée, relève `PLAFOND_ENTREES_GLOBAL` (et mesure ce que fait ton VPS avant), sinon l'alerte sonnera en continu. Le test de charge (`npm run charge`) ne sait pas encore viser un serveur distant : c'est un point ouvert du document.

## 8. Sauvegardes, mises à jour, retour arrière

### Sauvegardes

Le script `deploiement/sauvegarde.sh`, déclenché chaque nuit à 03 h 20 (heure du serveur) par `petit-cortege-sauvegarde.timer`, écrit un `pg_dump` compressé dans `/var/backups/petit-cortege/` (dossier en `0700`, réservé à root). Il garde les **7** dernières sauvegardes et supprime toute sauvegarde de plus de 7 jours, ce qui correspond à `dureeSauvegardes: '7 jours'` de la page Vie privée. **Les sauvegardes peuvent contenir des hachages de jetons de retrait** (ADR 0001) : ne les copie pas ailleurs sans appliquer la même durée et sans le dire dans la page Vie privée. Pour une autre durée : `Environment=DUREE_JOURS=…` dans `petit-cortege-sauvegarde.service`, **et** `dureeSauvegardes` dans `a-completer.ts`.

Vérifier que la minuterie est active, la lancer à la main, voir le résultat :

```sh
systemctl list-timers petit-cortege-sauvegarde.timer
```

```sh
sudo systemctl start petit-cortege-sauvegarde.service
```

```sh
sudo ls -lh /var/backups/petit-cortege/
```

Une sauvegarde qui reste sur le même disque ne protège pas d'une panne du VPS : prévois, si les données comptent, une copie hors du serveur… avec la contrainte de durée ci-dessus. Les fichiers publiés (`/var/lib/petit-cortege/publie`) se reconstituent depuis la base.

**Restaurer** (destructif : remplace la base actuelle). Remplace `<fichier>` par le nom de la sauvegarde :

```sh
sudo systemctl stop petit-cortege
```

```sh
sudo -u postgres dropdb petit_cortege && sudo -u postgres createdb -O petit_cortege petit_cortege
```

```sh
sudo bash -c 'runuser -u postgres -- pg_restore --no-owner --role=petit_cortege -d petit_cortege < /var/backups/petit-cortege/<fichier>'
```

```sh
sudo systemctl start petit-cortege
```

### Mettre à jour

Une fois les modifications poussées sur le dépôt :

```sh
sudo bash /opt/petit-cortege/deploiement/mettre-a-jour.sh
```

Il refuse de continuer s'il y a des modifications locales non commitées, fait `git fetch` puis une fusion en avance rapide, vérifie qu'il ne reste pas de `[À COMPLÉTER`, lance `npm ci --ignore-scripts` et `npm run build` (en transmettant `VITE_UMAMI_WEBSITE_ID` si elle est dans `/etc/petit-cortege.env`), met à jour le `Caddyfile` et les unités systemd si elles ont changé, puis redémarre le serveur. Il n'édite pas la configuration Nginx de la production : si la CSP a changé, recopie l'en-tête à la main (étape 5). Il affiche l'ancienne version : **note-la**. La construction vide `client/dist` quelques secondes (le site répond 404 pendant ce temps) : évite de le lancer au plus fort d'une manif. Les migrations de la base s'appliquent toutes seules au démarrage du serveur, dans l'ordre, une fois chacune.

### Retour arrière

Si une mise à jour casse le site : reviens au commit noté par `mettre-a-jour.sh` (« Version actuelle : … »), puis reconstruis :

```sh
cd /opt/petit-cortege && sudo git checkout <ancien-commit>
```

```sh
sudo bash /opt/petit-cortege/deploiement/mettre-a-jour.sh --sans-pull
```

Pour revenir ensuite sur la branche principale : `sudo git checkout main`. Attention : les migrations de la base ne se défont pas. Un retour arrière du code est sans risque tant que les migrations ajoutées entre-temps sont compatibles avec l'ancien code (elles sont des ajouts, en général) ; sinon, restaure la sauvegarde de la veille (ci-dessus).

## 9. Plus tard : un CDN (non utilisé)

> **Pas le site en production.** petit-cortege.fr n'a pas de CDN : les fichiers partent du VPS (pages légales, ADR 0005). Cette section n'a **pas été essayée**. Elle décrit une piste Bunny ; les réglages exacts sont à vérifier chez eux. L'ajouter exigerait de réécrire les pages légales et leur test, qui ne parlent plus d'un CDN.

Le CDN servirait à décharger le VPS de la bande passante des fichiers publiés (le test de charge compte sur ≈ 3,65 $ pour 100 000 soutiens, **avec compression** : docs/test-de-charge.md).

**Une tension à connaître.** Les pages légales et l'ADR 0005 gardent les POST et les fichiers sur le VPS. Or le client appelle l'API en chemin relatif (`/api/…`) : avec un CDN devant tout le domaine, les POST d'entrée passent par lui. Deux options : (a) mettre tout le domaine derrière le CDN avec ses journaux coupés, comme ci-dessous ; (b) faire servir l'API sous un autre nom de domaine, ce qui demande une petite modification du client (URL de l'API), hors du périmètre de ce guide. Décide laquelle avant de commencer.

Changements pour l'option (a) :

1. **Origine** : dans la « pull zone » Bunny, l'origine est ton VPS en HTTPS. Comme le domaine public passera chez Bunny, il faut un **nom d'origine** distinct qui pointe sur le VPS (ex. `origine.<ton-domaine>`, enregistrement `A` vers le VPS) : ajoute-le comme **second site** dans le `Caddyfile` (même contenu, autre nom) pour qu'il obtienne son certificat, et configure l'en-tête `Host` envoyé à l'origine en conséquence. Le domaine public devient un `CNAME` vers Bunny.
2. **Règles de cache** : que le CDN **respecte les `Cache-Control` de l'origine** (le `Caddyfile` pose déjà `max-age=30` sur `manifs.json` et `retraits.json`, `immutable` sur `entrees/*` et `assets/*`, `no-cache` sur `index.html` et `decors/*`) ; **ne pas mettre en cache `/api/*`** (règle de contournement) ; compression gzip ou brotli activée (c'est elle qui fait le facteur 3 du test de charge).
3. **`PROXYS_DE_CONFIANCE` et en-tête d'IP** : la chaîne devient CDN → Caddy → Node. Pour le serveur Node, rien ne change : il reçoit toujours ses requêtes de Caddy (`127.0.0.1`), donc `PROXYS_DE_CONFIANCE=127.0.0.1,::1` et `ENTETE_IP_CLIENT` inchangé (`X-Forwarded-For`). Ce qui change, c'est Caddy : derrière un CDN, l'adresse qu'il voit est celle du CDN, pas celle du visiteur. Il doit donc lire la vraie IP dans l'en-tête du CDN (`CDN-RequestClientIP` chez Bunny, à vérifier) **uniquement quand la connexion vient d'une plage d'adresses du CDN** (sinon n'importe qui forge l'en-tête et contourne la limite par IP), puis la transmettre à Node dans `X-Forwarded-For`. Dans le `Caddyfile`, cela se fait avec les options globales `trusted_proxies` (plages du CDN) et `client_ip_headers`, ou à défaut avec une condition `remote_ip` ; leur effet exact dépend de ta version de Caddy : lis sa documentation. Les plages d'adresses de Bunny sont publiées par Bunny et changent : ne les recopie pas une fois pour toutes. **C'est la partie la plus délicate : après la modification, refais le test de l'étape 5 (en-tête forgé) en passant par le CDN et en direct sur le VPS.** Option complémentaire : n'autoriser dans `ufw` que les plages du CDN sur 443.
4. **Journaux du CDN** : **désactive les journaux d'accès** dans les réglages de la zone (ou anonymise les IP si c'est la seule option offerte), car ils associeraient une IP à des URL. La page Vie privée ne mentionne plus de CDN : il faudrait la réécrire, avec le test, pour décrire ce choix sans rien affirmer d'invérifiable.
5. **Test** : relis `/publie/manifs.json` via le domaine public et vérifie les en-têtes (`cache-control`, et `content-encoding` côté CDN) ; relance un test de charge avant une vraie manif.

## Liste de contrôle avant ouverture

- [ ] Le domaine répond (`dig +short A <ton-domaine>` donne l'IP du VPS) et le site s'ouvre en HTTPS sans alerte.
- [ ] Connexion SSH par clé seulement, pas de connexion directe en `root`, `ufw` actif (22, 80, 443), `ufw logging off`.
- [ ] `sudo ss -tlnp` : Postgres et le serveur Node n'écoutent que sur `127.0.0.1`.
- [ ] `a-completer.ts` sans `[À COMPLÉTER` sur les 4 pages légales (relues dans le navigateur) ; `pages-legales.ts` adapté si l'hébergeur n'est pas OVH à Strasbourg ou si un CDN est ajouté.
- [ ] `VITE_UMAMI_WEBSITE_ID` défini avant le build si la mesure d'audience doit être active (sinon le script n'est pas chargé, alors que la page Vie privée la décrit).
- [ ] En-tête CSP de Nginx (production) : `https://stats.petit-cortege.fr` en `script-src` et `connect-src`. Le `Caddyfile` du dépôt est mis à jour par les scripts ; la configuration Nginx du VPS se recopie à la main.
- [ ] `dureeSauvegardes` du site = `DUREE_JOURS` de la sauvegarde (7 jours).
- [ ] `systemctl status petit-cortege` : actif ; `curl https://<ton-domaine>/api/defi` répond ; `curl -si …/publie/manifs.json` : 200 et `cache-control: public, max-age=30`.
- [ ] Le test de limite par IP avec `X-Forwarded-For` forgé (étape 5) donne des `429`.
- [ ] Une sauvegarde manuelle a été lancée et le fichier existe dans `/var/backups/petit-cortege/`.
- [ ] Une manif de test a été créée, vue sur le site depuis un téléphone, rejointe, puis retirée.
- [ ] Adresse de signalement : lue, et testée (envoie-toi un message).
- [ ] Le jour J : arrêté d'interdiction vérifié juste avant le départ ; `journalctl -u petit-cortege -f` ouvert.

## En cas de problème

| Symptôme | À regarder |
|----------|------------|
| `installer.sh` s'arrête sur « marqueurs À COMPLÉTER » | Normal : étape 4, puis relance. |
| Le site répond 404 sur `/` | `client/dist` absent : le site n'est pas construit (étape 5). |
| Pas de HTTPS / erreur de certificat | DNS (étape 1), ports 80 et 443 ouverts, `sudo journalctl -u caddy -n 50`. |
| `/api/defi` renvoie 502 | Le serveur Node ne tourne pas : `sudo journalctl -u petit-cortege -n 50`. |
| `Variable d'environnement … obligatoire` dans le journal | Une des quatre variables obligatoires manque dans `/etc/petit-cortege.env`. |
| `authentification par mot de passe échouée` (Postgres) | Le mot de passe de `DATABASE_URL` ne correspond plus à celui du rôle : voir l'étape 3. |
| Tous les soutiens reçoivent `429` | `PROXYS_DE_CONFIANCE` ne contient pas `127.0.0.1,::1`. |
| La page est blanche, la console du navigateur parle de `Content-Security-Policy` | Un changement du client demande une directive de plus dans le `Caddyfile` (lis le commentaire au-dessus de l'en-tête). En production le reverse proxy est Nginx : recopier le même en-tête dans son vhost, les scripts ne le font pas. |
