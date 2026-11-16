#!/usr/bin/env bash
# Installation de Petit Cortège sur un VPS Debian 12 ou Ubuntu 24.04 (ADR 0005 : Postgres +
# petit serveur Node + Caddy, sur la même machine, sans Supabase).
#
# À lancer en root, une fois le domaine pointé vers le VPS (voir docs/deploiement.md) :
#
#   sudo DOMAINE=<ton-domaine> bash deploiement/installer.sh
#
# Le script est IDEMPOTENT : tu peux le relancer sans risque, il ne refait que ce qui manque.
# Il ne supprime rien, n'écrase jamais /etc/petit-cortege.env ni la base, et ne touche ni à
# SSH ni au pare-feu (voir le guide).
#
# Ce qu'il fait : paquets (Node 22, Postgres 16, Caddy), utilisateur système, code dans
# /opt/petit-cortege, fichier d'environnement avec des secrets tirés au hasard, base et rôle
# Postgres, Caddy, service systemd, sauvegarde quotidienne, commandes `pc-moderation` et `pc-import-manifs`.
# Il s'ARRÊTE avant de construire le site tant que client/src/pages/a-completer.ts contient
# encore des marqueurs « [À COMPLÉTER » : remplis-les puis relance le script.
#
# Pas testé de bout en bout sur un VPS vierge au moment de l'écriture (voir docs/deploiement.md).

set -euo pipefail

# --- Paramètres (modifiables par variable d'environnement, ex. DOMAINE=… bash installer.sh) ---
DOMAINE="${DOMAINE:-}"                                        # obligatoire : ex. cortege.exemple.org
DEPOT_URL="${DEPOT_URL:-https://github.com/Kevw94/petit-cortege.git}"
BRANCHE="${BRANCHE:-main}"
DOSSIER_APP="${DOSSIER_APP:-/opt/petit-cortege}"
UTILISATEUR="${UTILISATEUR:-petit-cortege}"                   # utilisateur système sans privilèges
DOSSIER_DONNEES="/var/lib/petit-cortege"                      # doit correspondre au Caddyfile et au .service
FICHIER_ENV="/etc/petit-cortege.env"                          # idem
BASE="${BASE:-petit_cortege}"                                 # doit correspondre à DATABASE_URL de l'exemple
ROLE_PG="${ROLE_PG:-petit_cortege}"
NODE_MAJEUR_MIN=22
NODE_MINEUR_MIN=12                                            # engines : node >= 22.12
ACCEPTER_MARQUEURS="${ACCEPTER_MARQUEURS:-0}"                 # 1 = construire malgré les « À COMPLÉTER » (déconseillé)

# --- Utilitaires ---------------------------------------------------------------------------
info() { printf '\n==> %s\n' "$*"; }
avertir() { printf 'ATTENTION : %s\n' "$*" >&2; }
echec() { printf 'ERREUR : %s\n' "$*" >&2; exit 1; }

# Copie $1 vers $2 seulement si le contenu diffère ; renvoie 0 si le fichier a changé.
installer_si_different() {
  local source="$1" destination="$2" mode="${3:-0644}"
  if [ -f "$destination" ] && cmp -s "$source" "$destination"; then return 1; fi
  install -m "$mode" "$source" "$destination"
  return 0
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ "$(id -u)" -eq 0 ] || echec "à lancer en root (sudo)."
[ -n "$DOMAINE" ] || echec "indique ton domaine : sudo DOMAINE=<ton-domaine> bash deploiement/installer.sh"
case "$DOMAINE" in
  *'<'*|*'>'*|*' '*|*/*|http*) echec "DOMAINE doit être un nom de domaine nu (ex. cortege.exemple.org), reçu « $DOMAINE »." ;;
esac

# shellcheck disable=SC1091
. /etc/os-release
CODENAME="${VERSION_CODENAME:-}"
case "${ID:-}:${VERSION_ID:-}" in
  debian:12|ubuntu:24.04) ;;
  *) avertir "système non prévu (${PRETTY_NAME:-inconnu}) : prévu pour Debian 12 et Ubuntu 24.04." ;;
esac
export DEBIAN_FRONTEND=noninteractive

# --- 1. Paquets de base -------------------------------------------------------------------
info "Paquets de base"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg git openssl util-linux

# --- 2. Node.js >= 22.12 (dépôt NodeSource) ----------------------------------------------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v majeur mineur
  v="$(node -p 'process.versions.node')"
  majeur="${v%%.*}"; mineur="${v#*.}"; mineur="${mineur%%.*}"
  [ "$majeur" -gt "$NODE_MAJEUR_MIN" ] || { [ "$majeur" -eq "$NODE_MAJEUR_MIN" ] && [ "$mineur" -ge "$NODE_MINEUR_MIN" ]; }
}
if node_ok; then
  info "Node.js déjà présent : $(node -v)"
else
  info "Installation de Node.js $NODE_MAJEUR_MIN (dépôt NodeSource)"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJEUR_MIN}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
  node_ok || echec "Node.js >= ${NODE_MAJEUR_MIN}.${NODE_MINEUR_MIN} introuvable après installation (version : $(node -v 2>/dev/null || echo aucune))."
fi
# Le service lance /usr/bin/node (voir petit-cortege.service).
[ -x /usr/bin/node ] || echec "/usr/bin/node absent : adapte ExecStart dans petit-cortege.service (chemin de node : $(command -v node))."

# --- 3. Postgres 16 -----------------------------------------------------------------------
info "Installation de Postgres (sans effet s'il est déjà installé)"
if [ "${ID:-}" = "debian" ]; then
  # Debian 12 fournit Postgres 15 : on prend la 16 dans le dépôt officiel PGDG.
  if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor --yes -o /usr/share/keyrings/postgresql.gpg
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
  fi
  apt-get install -y -qq postgresql-16
else
  apt-get install -y -qq postgresql   # Ubuntu 24.04 : version 16
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
PG_VERSION="$(runuser -u postgres -- psql -tAc 'show server_version_num' | head -n1 | cut -c1-2)"
[ "$PG_VERSION" = "16" ] || avertir "Postgres $PG_VERSION détecté ; le projet est testé avec la 16."
info "Postgres version majeure : $PG_VERSION"

# --- 4. Caddy (dépôt officiel) -------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  info "Installation de Caddy"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# --- 5. Utilisateur système et dossiers ---------------------------------------------------
if ! getent passwd "$UTILISATEUR" >/dev/null; then
  info "Création de l'utilisateur système $UTILISATEUR"
  useradd --system --user-group --home-dir "$DOSSIER_DONNEES" --create-home --shell /usr/sbin/nologin "$UTILISATEUR"
fi
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 "$DOSSIER_DONNEES" "$DOSSIER_DONNEES/publie"

# --- 6. Code -------------------------------------------------------------------------------
if [ -f "$DOSSIER_APP/package.json" ]; then
  info "Code déjà présent dans $DOSSIER_APP (non modifié ; pour le mettre à jour : mettre-a-jour.sh)"
else
  info "Récupération du code dans $DOSSIER_APP"
  [ ! -e "$DOSSIER_APP" ] || [ -z "$(ls -A "$DOSSIER_APP")" ] || echec "$DOSSIER_APP existe, n'est pas vide et ne contient pas le projet."
  git clone --branch "$BRANCHE" "$DEPOT_URL" "$DOSSIER_APP" \
    || echec "clonage impossible (dépôt privé ? voir docs/deploiement.md, « Récupérer le code »)."
fi
[ -f "$DOSSIER_APP/deploiement/Caddyfile" ] || echec "$DOSSIER_APP ne ressemble pas au dépôt (deploiement/Caddyfile absent)."
DEPLOIEMENT="$DOSSIER_APP/deploiement"

# --- 7. Fichier d'environnement (secrets tirés au hasard, jamais écrasé) ---------------------
if [ -f "$FICHIER_ENV" ]; then
  info "$FICHIER_ENV existe déjà : conservé tel quel."
else
  info "Création de $FICHIER_ENV avec des secrets aléatoires"
  MDP_PG="$(openssl rand -hex 24)"
  CLE_ALTCHA="$(openssl rand -hex 32)"
  (
    umask 0137   # fichier créé en 0640
    sed -e "s#<mot-de-passe-postgres>#${MDP_PG}#" \
        -e "s#<cle-hexadecimale-de-64-caracteres>#${CLE_ALTCHA}#" \
        "$DEPLOIEMENT/petit-cortege.env.exemple" > "$FICHIER_ENV"
  )
  chown "root:$UTILISATEUR" "$FICHIER_ENV"
  chmod 0640 "$FICHIER_ENV"
  unset MDP_PG CLE_ALTCHA
fi
if grep -q '<' <(grep -v '^#' "$FICHIER_ENV"); then
  echec "$FICHIER_ENV contient encore un espace réservé <…> : remplis-le puis relance."
fi

# --- 8. Rôle et base Postgres ---------------------------------------------------------------
# Le mot de passe est relu dans DATABASE_URL (postgres://role:MOT_DE_PASSE@hôte:port/base).
MDP_PG="$(sed -n 's#^DATABASE_URL=postgres://[^:]*:\([^@]*\)@.*#\1#p' "$FICHIER_ENV" | head -n1)"
[ -n "$MDP_PG" ] || echec "mot de passe introuvable dans DATABASE_URL ($FICHIER_ENV)."
psql_admin() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tA "$@"; }
if [ "$(psql_admin -c "select 1 from pg_roles where rolname = '$ROLE_PG'")" = "1" ]; then
  info "Rôle Postgres $ROLE_PG déjà présent (mot de passe inchangé : s'il ne correspond plus à DATABASE_URL, voir le guide)."
else
  info "Création du rôle Postgres $ROLE_PG"
  # Nom et mot de passe passent par des variables psql (pas d'interpolation dans la ligne de commande).
  psql_admin -v "role=$ROLE_PG" -v "mdp=$MDP_PG" >/dev/null <<'SQL'
create role :"role" login password :'mdp';
SQL
fi
unset MDP_PG
if [ "$(psql_admin -c "select 1 from pg_database where datname = '$BASE'")" = "1" ]; then
  info "Base $BASE déjà présente."
else
  info "Création de la base $BASE"
  psql_admin -c "create database \"$BASE\" owner \"$ROLE_PG\" encoding 'UTF8'" >/dev/null
fi

# --- 9. Journald : conservation courte ------------------------------------------------------
install -d -m 0755 /etc/systemd/journald.conf.d
cat > "$TMP/journald.conf" <<'EOF'
# Petit Cortège : journaux conservés 7 jours au plus (docs/deploiement.md, vie privée).
[Journal]
MaxRetentionSec=7day
SystemMaxUse=500M
EOF
if installer_si_different "$TMP/journald.conf" /etc/systemd/journald.conf.d/petit-cortege.conf; then
  systemctl restart systemd-journald
fi

# --- 10. Caddy : Caddyfile + domaine -----------------------------------------------------------
info "Configuration de Caddy pour $DOMAINE"
install -d -m 0755 /etc/caddy /etc/systemd/system/caddy.service.d
if [ -f /etc/caddy/Caddyfile ] && ! cmp -s "$DEPLOIEMENT/Caddyfile" /etc/caddy/Caddyfile && [ ! -f /etc/caddy/Caddyfile.avant-petit-cortege ]; then
  cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.avant-petit-cortege   # sauvegarde de l'ancien fichier, une seule fois
fi
installer_si_different "$DEPLOIEMENT/Caddyfile" /etc/caddy/Caddyfile || true
printf '[Service]\nEnvironment=DOMAINE=%s\n' "$DOMAINE" > "$TMP/caddy-domaine.conf"
installer_si_different "$TMP/caddy-domaine.conf" /etc/systemd/system/caddy.service.d/petit-cortege.conf || true
DOMAINE="$DOMAINE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || { DOMAINE="$DOMAINE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; echec "Caddyfile invalide."; }

# --- 11. Unités systemd (serveur, sauvegarde) et commande de modération ------------------------------
info "Installation des unités systemd"
for unite in petit-cortege.service petit-cortege-sauvegarde.service petit-cortege-sauvegarde.timer; do
  installer_si_different "$DEPLOIEMENT/$unite" "/etc/systemd/system/$unite" || true
done
systemctl daemon-reload
chmod 0755 "$DEPLOIEMENT/sauvegarde.sh" "$DEPLOIEMENT/moderation.sh" "$DEPLOIEMENT/import-manifs.sh" "$DEPLOIEMENT/mettre-a-jour.sh" "$DEPLOIEMENT/installer.sh"
ln -sfn "$DEPLOIEMENT/moderation.sh" /usr/local/bin/pc-moderation
ln -sfn "$DEPLOIEMENT/import-manifs.sh" /usr/local/bin/pc-import-manifs
install -d -m 0700 /var/backups/petit-cortege

# --- 12. Construction du site et démarrage -------------------------------------------------------
cd "$DOSSIER_APP"
MARQUEURS="$(grep -cE "^[[:space:]]*([A-Za-z]+:[[:space:]]*)?'\\[À COMPLÉTER" client/src/pages/a-completer.ts || true)"
if [ "$MARQUEURS" -gt 0 ] && [ "$ACCEPTER_MARQUEURS" != "1" ]; then
  cat <<EOF

--------------------------------------------------------------------------------
Installation du système terminée, mais le site n'est PAS encore construit :
client/src/pages/a-completer.ts contient encore $MARQUEURS marqueur(s) « [À COMPLÉTER ».
Ils s'afficheraient tels quels sur le site (mentions légales, vie privée…).

  1. Remplis ce fichier (docs/deploiement.md, étape 4), puis commite-le.
  2. Relance : sudo DOMAINE=$DOMAINE bash $DEPLOIEMENT/installer.sh
--------------------------------------------------------------------------------
EOF
  exit 0
fi
[ "$MARQUEURS" -eq 0 ] || avertir "construction malgré $MARQUEURS marqueur(s) « À COMPLÉTER » (ACCEPTER_MARQUEURS=1)."

info "Installation des dépendances (npm ci) et construction du client (npm run build)"
npm ci --ignore-scripts   # pas de scripts d'installation des dépendances exécutés en root (build et serveur fonctionnent sans, vérifié)
# VITE_UMAMI_WEBSITE_ID est lue par Vite au build, pas par le serveur. Si elle est dans
# /etc/petit-cortege.env, on la transmet. Sinon Vite la prend dans client/.env.production.
# Vide ou absente : le client ne charge pas le script de mesure.
if [ -z "${VITE_UMAMI_WEBSITE_ID:-}" ] && [ -f "$FICHIER_ENV" ]; then
  lu="$(grep -E '^VITE_UMAMI_WEBSITE_ID=' "$FICHIER_ENV" | head -n 1 | cut -d= -f2- || true)"
  if [ -n "${lu}" ]; then export VITE_UMAMI_WEBSITE_ID="$lu"; fi
fi
npm run build
[ -f client/dist/index.html ] || echec "client/dist/index.html absent après la construction."

info "Démarrage des services"
systemctl enable petit-cortege.service petit-cortege-sauvegarde.timer caddy >/dev/null 2>&1
systemctl restart petit-cortege.service
systemctl restart caddy
systemctl start petit-cortege-sauvegarde.timer

sleep 3
systemctl --no-pager --lines=0 status petit-cortege.service || true
cat <<EOF

--------------------------------------------------------------------------------
Terminé. Vérifie (étape 5 du guide) :
  curl -s https://$DOMAINE/api/defi | head -c 120
  curl -si https://$DOMAINE/publie/manifs.json | head -n 12
(le certificat HTTPS peut mettre une minute à être émis ; DNS requis)

Prochaine étape : ajouter une manif (étape 6) avec  pc-moderation aide
--------------------------------------------------------------------------------
EOF
