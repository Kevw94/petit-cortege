#!/usr/bin/env bash
# Commande de modération sur le VPS : `pc-moderation <commande> [options]` (lien posé par
# installer.sh dans /usr/local/bin). Équivalent de `npm run moderation -- <commande> …` (voir
# scripts/moderation.ts), mais :
#  - lancé en root, il exécute la commande sous l'utilisateur du service, avec le même
#    environnement que le service (/etc/petit-cortege.env : base, dossier de publication) ;
#  - les fichiers qu'il crée dans /var/lib/petit-cortege/publie appartiennent donc au service.
#
# Exemples : pc-moderation aide   |   pc-moderation lister
# Les chemins de fichiers (--geojson) se résolvent depuis /opt/petit-cortege : donne-les en
# absolu (le fichier doit être lisible par l'utilisateur du service, ex. sous /opt/petit-cortege/donnees/).

set -euo pipefail

UTILISATEUR="${UTILISATEUR:-petit-cortege}"
FICHIER_ENV="${FICHIER_ENV:-/etc/petit-cortege.env}"
# Dossier du projet : celui qui contient ce script (suit le lien symbolique).
DOSSIER_APP="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "ERREUR : à lancer en root (sudo pc-moderation …)." >&2; exit 1; }
[ -r "$FICHIER_ENV" ] || { echo "ERREUR : $FICHIER_ENV illisible." >&2; exit 1; }

# Le shell interne charge l'environnement du service, puis lance la même commande que
# `npm run moderation` (tsx scripts/moderation.ts), sans la couche npm.
# shellcheck disable=SC2016  # les $1, $2, $@ sont voulus pour le shell interne
exec runuser -u "$UTILISATEUR" -- env HOME="/var/lib/$UTILISATEUR" bash -c '
  set -euo pipefail
  set -a; . "$1"; set +a
  cd "$2"
  shift 2
  exec node --import tsx scripts/moderation.ts "$@"
' moderation "$FICHIER_ENV" "$DOSSIER_APP" "$@"
