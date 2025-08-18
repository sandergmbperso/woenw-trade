# Woenw Trade

Projet web expérimental pour lister et gérer des cartes (version test).  
Objectif : afficher les cartes depuis un fichier JSON, puis ajouter recherche, filtres, wishlist/doublons et comparaison entre amis.  

## Fonctionnalités actuelles (V0.2.2)

- Tableau HTML lisible (CSS minimal).  
- Données externalisées dans `cards.json` (chargées via `fetch`).  
- Génération dynamique des lignes par JavaScript.  
- Gestion d’erreur si `cards.json` est introuvable ou invalide (message affiché dans le tableau).  

---

## Historique des versions

| Étape / Version | Ajout principal      | Description                                     |
|-----------------|----------------------|-------------------------------------------------|
| V0.1            | Tableau statique     | HTML seul avec 10 cartes codées en dur.         |
| V0.2            | Génération JS        | Lignes `<tr>` créées côté client (JavaScript).  |
| V0.2.1          | Fichier cards.json   | Données séparées dans un fichier JSON + fetch. |
| V0.2.2          | Gestion erreurs      | Message si le JSON est introuvable / mal chargé.|

---

## Roadmap

- **V0.3** : Champ de recherche par nom (filtrage client, insensible à la casse/accents).  
- **V0.4** : Filtres Type / Rareté / Extension (menus déroulants).  
- **V0.5** : Boutons “Wishlist” et “Doublon” (stockage localStorage).  
- **V0.6** : Multi-profils (amis : Pocho, Julien, Yaël, David) avec listes séparées.  
- **V1.0** : Partage & comparaison (détection d’échanges possibles entre amis).  

---

## Installation & exécution

```bash
# 1) Cloner le repo
git clone git@github-perso:sandergmbperso/woenw-trade.git
cd woenw-trade

# 2) Lancer un serveur local
# Option A : VS Code → extension "Live Server"
# Option B : terminal Python
python -m http.server 5500
```

👉 Ajoute la ligne problématique ici  

---

## Convention de commits & tags

### Commits (obligatoire)

Format **Conventional Commits** avec version explicite :  

```bash
feat(vX.X): description     # nouvelle fonctionnalité
fix(vX.X): description      # correction de bug
refactor(vX.X): description # refactorisation sans changement fonctionnel
docs(vX.X): description     # documentation
chore(vX.X): description    # tâches techniques, config, dépendances
```

Exemples :  

```bash
git commit -m "feat(v0.3): ajout du champ de recherche par nom"
git commit -m "fix(v0.3): normaliser les accents dans le filtre"
```

### Tags (obligatoire)

Chaque version stable doit être taguée et poussée :  

```bash
git tag -a v0.2.2 -m "Version 0.2.2"
git push origin v0.2.2

# ou pousser tous les tags existants
git push --tags
```

---

## Workflow Git recommandé

```bash
# Créer une branche pour chaque évolution
git checkout -b feature/v0.3-search

# Développer, tester localement
# Commits au format requis

# Pousser la branche
git push -u origin feature/v0.3-search
```

Puis :  

- Ouvrir une Pull Request → revue → merge vers `main`.  
- Créer un tag de version sur `main` après merge (**obligatoire**).  

---

## Licence

Projet personnel (non lié à l’activité professionnelle).  
