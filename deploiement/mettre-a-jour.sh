#!/usr/bin/env bash
# Mise à jour de Petit Cortège sur le VPS : récupère le code, reconstruit, redémarre.
#
#   sudo bash /opt/petit-cortege/deploiement/mettre-a-jour.sh              # git pull puis tout reconstruire
#   sudo bash /opt/petit-cortege/deploiement/mettre-a-jour.sh --sans-pull  # reconstruire le code tel qu'il est
#                                                                          # (après un changement local, ou un retour arrière)
#
# Idempotent : relançable sans risque. Ne touche ni à la base (les migrations s'appliquent
# toutes seules au démarrage du serveur, dans l'ordre, une seule fois chacune), ni à
# /etc/petit-cortege.env, ni aux fichiers publiés.
#
# Retour arrière : docs/deploiement.md, « Retour arrière ». Ce script affiche le commit de départ.

set -euo pipefail

DOSSIER_APP="${DOSSIER_APP:-/opt/petit-cortege}"
BRANCHE="${BRANCHE:-main}"
ACCEPTER_MARQUEURS="${ACCEPTER_MARQUEURS:-0}"
SANS_PULL=0

info() { printf '\n==> %s\n' "$*"; }
echec() { printf 'ERREUR : %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  '') ;;
  --sans-pull) SANS_PULL=1 ;;
  *) echec "option inconnue « $1 » (seule --sans-pull existe)." ;;
esac

[ "$(id -u)" -eq 0 ] || echec "à lancer en root (sudo)."
[ -f "$DOSSIER_APP/package.json" ] || echec "$DOSSIER_APP ne contient pas le projet."
cd "$DOSSIER_APP"

# Copie $1 vers $2 seulement si le contenu diffère ; renvoie 0 si le fichier a changé.
installer_si_different() {
  local source="$1" destination="$2" mode="${3:-0644}"
  if [ -f "$destination" ] && cmp -s "$source" "$destination"; then return 1; fi
  install -m "$mode" "$source" "$destination"
  return 0
}

AVANT="$(git rev-parse HEAD)"
info "Version actuelle : $AVANT (note-la : c'est le point de retour arrière)"

if [ "$SANS_PULL" -eq 0 ]; then
  # On refuse de mettre à jour par-dessus des modifications locales non commitées : elles
  # seraient mélangées au code récupéré. Commite-les (ex. a-completer.ts) ou annule-les.
  [ -z "$(git status --porcelain --untracked-files=no)" ] \
    || { git status --short --untracked-files=no >&2; echec "modifications locales non commitées (voir ci-dessus). Commite-les, ou lance avec --sans-pull."; }
  info "Récupération du code ($BRANCHE)"
  git fetch --quiet origin "$BRANCHE"
  git checkout --quiet "$BRANCHE"
  git merge --ff-only "origin/$BRANCHE" \
    || echec "fusion impossible en avance rapide : ta branche locale a des commits que le dépôt n'a pas (voir le guide)."
fi
APRES="$(git rev-parse HEAD)"

MARQUEURS="$(grep -cE "^[[:space:]]*([A-Za-z]+:[[:space:]]*)?'\\[À COMPLÉTER" client/src/pages/a-completer.ts || true)"
if [ "$MARQUEURS" -gt 0 ] && [ "$ACCEPTER_MARQUEURS" != "1" ]; then
  echec "client/src/pages/a-completer.ts contient encore $MARQUEURS marqueur(s) « [À COMPLÉTER » : remplis-les et commite avant de reconstruire."
fi

info "Dépendances et construction du client"
npm ci --ignore-scripts   # pas de scripts d'installation des dépendances exécutés en root (build et serveur fonctionnent sans, vérifié)
# VITE_UMAMI_WEBSITE_ID est lue par Vite au build, pas par le serveur. Si elle est dans
# /etc/petit-cortege.env, on la transmet. Sinon Vite la prend dans client/.env.production.
# Vide ou absente : le client ne charge pas le script de mesure.
if [ -z "${VITE_UMAMI_WEBSITE_ID:-}" ] && [ -f /etc/petit-cortege.env ]; then
  lu="$(grep -E '^VITE_UMAMI_WEBSITE_ID=' /etc/petit-cortege.env | head -n 1 | cut -d= -f2- || true)"
  if [ -n "${lu}" ]; then export VITE_UMAMI_WEBSITE_ID="$lu"; fi
fi
npm run build
[ -f client/dist/index.html ] || echec "client/dist/index.html absent après la construction."

info "Fichiers de déploiement (Caddyfile, unités systemd)"
DEPLOIEMENT="$DOSSIER_APP/deploiement"
changement_systemd=0
for unite in petit-cortege.service petit-cortege-sauvegarde.service petit-cortege-sauvegarde.timer; do
  if installer_si_different "$DEPLOIEMENT/$unite" "/etc/systemd/system/$unite"; then
    echo "mis à jour : $unite"; changement_systemd=1
  fi
done
[ "$changement_systemd" -eq 0 ] || systemctl daemon-reload
if installer_si_different "$DEPLOIEMENT/Caddyfile" /etc/caddy/Caddyfile; then
  echo "mis à jour : Caddyfile"
  DOMAINE="$(sed -n 's/^Environment=DOMAINE=//p' /etc/systemd/system/caddy.service.d/petit-cortege.conf)"
  DOMAINE="$DOMAINE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null \
    || echec "le nouveau Caddyfile est invalide (l'ancien n'est plus en place : vois /etc/caddy/Caddyfile.avant-petit-cortege)."
  systemctl reload caddy
fi

info "Redémarrage du serveur"
systemctl restart petit-cortege.service
sleep 3
systemctl is-active --quiet petit-cortege.service \
  || { journalctl -u petit-cortege.service -n 30 --no-pager >&2; echec "le serveur ne démarre pas (journal ci-dessus). Retour arrière : voir le guide ; ancienne version : $AVANT"; }

echo
echo "Terminé. $AVANT -> $APRES"
echo "Vérifie : curl -s https://<ton-domaine>/api/defi | head -c 80"
