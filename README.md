# Bier-Tracker

Private Web-App (PWA) zum Tracken getrunkener Biere – mit Barcode-Scan, Brauerei-Sortimenten und Karte.

- **Frontend:** Vite + React + TypeScript, als PWA installierbar (iPhone & Android)
- **Backend:** Supabase (Postgres, Login, Row Level Security)
- **Hosting:** GitHub Pages, Deployment automatisch bei jedem Push auf `main`
- **Keepalive:** GitHub Action pingt Supabase 2× pro Woche, damit das Gratis-Projekt nicht pausiert

## Einrichtung

Einmalig `setup.bat` (Windows) bzw. `python setup.py` ausführen. Das Skript
legt die Datenbank an, erstellt dein App-Konto, sperrt weitere Registrierungen,
lädt den Code ins Repo und schaltet GitHub Pages ein.

## Struktur

| Pfad | Inhalt |
| --- | --- |
| `src/pages/` | Seiten: Meine Biere, Scannen, Neues Bier, Bier, Brauereien, Brauerei, Karte, Mehr |
| `src/api.ts` | Datenzugriff (Supabase), Open Food Facts, Nominatim |
| `supabase/migrations/` | Datenbankschema (idempotent) |
| `.github/workflows/` | Deploy + Keepalive |

## Lokal entwickeln

```
npm install
npm run dev
```
