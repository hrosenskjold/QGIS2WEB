# Opsætning af webkortet

## 1. GitHub-repo og Pages — ✅ allerede sat op
- Repo: https://github.com/hrosenskjold/QGIS2WEB (public)
- Webkort: https://hrosenskjold.github.io/QGIS2WEB/
- Pages serveres fra branch `main`, mappe `/ (root)`.
- `data/layers.geojson` findes som en tom FeatureCollection, indtil du publicerer lag fra QGIS.

Skal indholdet af denne `web/`-mappe opdateres på siden igen senere, uploades filerne
blot til roden af det repo.

## 2. Personal Access Token (til at gemme observationer og publicere lag)
1. Gå til GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Opret en ny token der **kun** har adgang til det ene repo, og **kun** rettigheden "Contents: Read and write".
3. Gem token et sikkert sted – den vises kun én gang.
4. Indsæt den i webkortets indstillinger (tandhjulet nederst til højre) og i QGIS-pluginets indstillinger.

⚠️ Denne token ligger i browserens `localStorage` på den enhed du bruger til at tilføje observationer. Del den ikke, og brug kun en token med minimal adgang (kun dette ene repo, kun Contents).

## 3. Firebase Realtime Database (til live position)
1. Opret et gratis projekt på https://console.firebase.google.com.
2. Opret en "Realtime Database" (ikke Firestore) i testmode.
3. Sæt følgende regler (kan strammes yderligere senere, fx med et delt hemmeligt device-id i stien):
   ```json
   {
     "rules": {
       "positions": {
         "main": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
4. Kopiér database-URL'en (fx `https://dit-projekt-default-rtdb.europe-west1.firebasedatabase.app`) ind i webkortets og QGIS-pluginets indstillinger.

## 4. Test lokalt før upload
Geolocation kræver `https://` eller `localhost`. Test derfor lokalt med:

```
cd web
python -m http.server 8000
```

og åbn `http://localhost:8000` i browseren.

## 5. Ikon (valgfrit)
`manifest.json` har i øjeblikket ingen ikoner. Læg et `icon-192.png` og
`icon-512.png` i denne mappe og tilføj dem til `manifest.json`, hvis du vil
have et pænt ikon når siden føjes til hjemmeskærmen.
