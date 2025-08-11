# Chemin minimal — Graphe pondéré (Solo)

Jeu solo de chemin à score minimal sur un graphe pondéré.

- 11 lignes, 8 colonnes par ligne
- Observation 45 s, jeu 60 s
- Déplacements: ligne N -> N+1, même colonne ou adjacente
- Score: somme des différences absolues entre points successifs (le premier point n’ajoute rien)

## Utilisation
Ouvrez simplement `index.html` dans votre navigateur (serveur statique optionnel).

## Structure
- `index.html` / `styles.css` / `app.js`

## Règle du score
Soit un chemin de valeurs v1, v2, ..., vn. Score = Σ |v(i) - v(i-1)| pour i = 2..n.

## Chemin optimal
Calculé en programmation dynamique (coût 0 sur la première ligne, transitions = |Δ|).

## Licence
Usage interne.
