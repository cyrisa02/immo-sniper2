Solution long terme (recommandée) : les alertes email comme source
C'est la méthode la plus fiable et indétectable :

    Crée un compte Leboncoin (si pas déjà fait)
    Configure des alertes email sur tes zones cibles :
        "Maisons à vendre dans l'Oise"
        "Maisons à vendre à Beauvais + 15km"
    Quand tu reçois un email, copie les URLs dans urls.txt
    Lance le batch :

   npx tsx scripts/batch-scraper.ts file urls.txt
   npx tsx scripts/detect-opportunities.ts --send-email


1. Leboncoin (déjà fonctionnel ✅)

    Crée un compte Leboncoin
    Fais une recherche : "Maisons à vendre dans l'Oise"
    Clique sur "Sauvegarder la recherche" (bouton orange)
    Active les alertes email
    Quand tu reçois un email → copie les URLs dans urls.txt

2. SeLoger (même méthode)

    Crée un compte sur SeLoger.com
    Fais ta recherche :
        Localisation : "Oise (60)" ou "Beauvais + 15km"
        Type de bien : Maison
        Prix max : selon ton budget
    Clique sur "Créer une alerte" (cloche en haut à droite)
    Configure la fréquence : "Immédiat" pour être réactif
    Quand tu reçois un email → copie les URLs dans urls.txt