#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Postgres (lancée par petit-cortege-sauvegarde.timer, ou à la main).
#
# - Un fichier `pg_dump` (format personnalisé, compressé) par exécution, dans un dossier
#   en 0700 réservé à root.
# - Rotation : on garde les DUREE_JOURS dernières sauvegardes (au plus une par jour), et on
#   supprime toute sauvegarde de plus de DUREE_JOURS jours, sauf la plus récente.
#
# ADR 0001 : une sauvegarde peut contenir des hachages de jetons de retrait (effacés de la
# base 1 h après la fin d'une manif, mais pas des sauvegardes déjà faites). La durée de
# conservation ci-dessous DOIT être celle annoncée au public dans le champ `dureeSauvegardes`
# de client/src/pages/a-completer.ts (page « Vie privée »). Si tu changes l'une, change l'autre.
#
# Restauration : voir docs/deploiement.md, « Sauvegardes ».

set -euo pipefail

DUREE_JOURS="${DUREE_JOURS:-7}"                                  # = « 7 jours » dans a-completer.ts
BASE="${BASE:-petit_cortege}"
DOSSIER_SAUVEGARDES="${DOSSIER_SAUVEGARDES:-/var/backups/petit-cortege}"

[ "$(id -u)" -eq 0 ] || { echo "ERREUR : à lancer en root." >&2; exit 1; }
case "$DUREE_JOURS" in ''|*[!0-9]*|0) echo "ERREUR : DUREE_JOURS doit être un entier >= 1 (reçu « $DUREE_JOURS »)." >&2; exit 1 ;; esac

umask 077
install -d -m 0700 "$DOSSIER_SAUVEGARDES"
horodatage="$(date -u +%Y%m%dT%H%M%SZ)"
final="$DOSSIER_SAUVEGARDES/petit-cortege-$horodatage.dump"
temporaire="$final.en-cours"

# `pg_dump` sous l'utilisateur « postgres » (authentification par le système, sans mot de passe).
# Écrit dans un fichier temporaire puis renommé : jamais de sauvegarde à moitié écrite sous le bon nom.
trap 'rm -f "$temporaire"' EXIT
runuser -u postgres -- pg_dump --format=custom --compress=6 "$BASE" > "$temporaire"
[ -s "$temporaire" ] || { echo "ERREUR : sauvegarde vide." >&2; exit 1; }
mv "$temporaire" "$final"
echo "Sauvegarde écrite : $final ($(du -h "$final" | cut -f1))"

# --- Rotation (les noms contiennent l'horodatage : l'ordre alphabétique est l'ordre chronologique) ---
mapfile -t fichiers < <(find "$DOSSIER_SAUVEGARDES" -maxdepth 1 -type f -name 'petit-cortege-*.dump' | sort)
total="${#fichiers[@]}"
plus_recent="${fichiers[$((total - 1))]}"
limite_s=$(( $(date +%s) - DUREE_JOURS * 86400 ))
for i in "${!fichiers[@]}"; do
  f="${fichiers[$i]}"
  [ "$f" != "$plus_recent" ] || continue
  trop_nombreux=$(( total - i > DUREE_JOURS ? 1 : 0 ))
  trop_vieux=0
  [ "$(stat -c %Y "$f")" -lt "$limite_s" ] && trop_vieux=1
  if [ "$trop_nombreux" -eq 1 ] || [ "$trop_vieux" -eq 1 ]; then
    rm -f -- "$f"
    echo "Supprimée (rotation, $DUREE_JOURS jours) : $f"
  fi
done
