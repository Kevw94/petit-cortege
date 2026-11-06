# Lien appareil ↔ manif éphémère, jamais par IP

Les opinions politiques sont des données sensibles (RGPD art. 9). Un lien strictement nul entre une personne et une manif est intenable (anti-triche, notification de fin, journaux de l'hébergeur), et le hachage d'identifiants est une fausse anonymisation (une IPv4 hachée se retrouve par force brute). On tolère donc un lien **éphémère** : jeton aléatoire par appareil (jamais l'IP), limite de débit en mémoire uniquement, toute donnée reliant un appareil à une manif effacée au plus tard 1 h après la fin de la manif.

## Conséquences

- Un avatar est un enregistrement anonyme (manif, heure d'entrée arrondie à la minute + aléa, apparence, pancarte). Le jeton de retrait (128 bits) reste dans le localStorage ; seul son SHA-256 est stocké. Il est distinct du jeton anti-triche, pour ne pas recréer de lien. Le client efface le jeton de son localStorage à la fin de la manif.
- Une future adresse push suivrait la même règle : supprimée après l'envoi de la notification de fin.
- Dans l'heure qui suit la fin, le hachage du jeton de retrait est effacé ; l'avatar anonyme est conservé (l'image finale en est recalculée). Suppression ponctuelle possible sur signalement.
- Anti-triche : preuve de travail (ALTCHA auto-hébergé) à chaque entrée, limite de débit par IP **en mémoire uniquement, jamais écrite**, seuil généreux (IP partagées), alerte équipe sur un plafond de débit global. Le compteur affiche des « soutiens », pas un chiffre certifié.
