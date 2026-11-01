# Scrabble (ChadGangGames)

Jeu statique : `index.html` + `style.css` + `fx.js` + `game.js`. Multijoueur en ligne (2 à 4) via le SDK du hub.

## Dictionnaire
Déposer à la racine un fichier **`mots.txt`** : un mot par ligne (majuscules, sans accents ni tirets, 2 à 15 lettres ; accents et minuscules sont de toute façon normalisés au chargement).
- Avec `mots.txt` : les mots sont validés automatiquement. Un mot refusé peut être proposé aux modos (liste partagée « mots » du hub).
- Sans `mots.txt` : mode « contestation » : les adversaires peuvent contester le dernier coup, qui est alors annulé (le joueur perd son tour).
