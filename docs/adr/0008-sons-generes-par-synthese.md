# Sons générés par synthèse dans le navigateur, chant local sans paroles

Le porteur veut une musique douce sur l'accueil, une ambiance de foule dans la vue d'une manif et la possibilité de « lancer un chant ». Un enregistrement ou un échantillon poserait des questions de licence (ADR 0006), un chant ou un slogan reconnaissable prendrait parti (ADR 0003), et tout fichier ou service tiers ajouterait des requêtes (ADR 0002). Tout le son est donc **synthétisé dans le navigateur avec la Web Audio API** (`client/src/son/`) : aucun fichier audio, aucun échantillon, aucune bibliothèque ni dépendance. La musique d'accueil est une composition originale générée par règles (accords tenus, arpège en marche aléatoire sur la pentatonique) ; l'ambiance est du bruit filtré et modulé, des pas, des percussions lointaines, un sifflet et des applaudissements de synthèse ; un chant est un appel-réponse rythmique générique (tambour, mains, chœur de formants « hé / ho »), **sans paroles ni voix intelligible**. Le chant est **local** : il ne s'entend et ne se voit que sur l'appareil du soutien, rien n'est envoyé au serveur (pas de temps réel, ADR 0004).

## Conséquences

- Aucune mélodie, aucun hymne, chant de lutte, slogan scandé ou jingle existant ne doit être repris : partitions et motifs sont écrits ici, sous forme de données testées.
- Le seul texte affiché pendant un chant est le slogan de la pancarte de son propre avatar (catalogue `SLOGANS`), sinon une simple pulsation.
- Le son ne démarre qu'après un geste (politique d'autoplay), activé par défaut ; le choix de le couper est mémorisé dans le localStorage, jamais envoyé. Onglet caché, son coupé ou page sans son : contexte audio suspendu.
- Les chants et réactions partagés en réseau restent hors V1 : ils demanderaient des POST protégés contre la triche (ADR 0004).
