# Plopp! – Der Biertracker

Private Web-App (PWA) zum Tracken getrunkener Biere – mit Barcode-Scan, Brauerei-Sortimenten und Karte.

- **Frontend:** Vite + React + TypeScript, als PWA installierbar (iPhone & Android)
- **Backend:** Supabase (Postgres, Login, Row Level Security)
- **Hosting:** GitHub Pages, Deployment automatisch bei jedem Push auf `main`
- **Keepalive:** GitHub Action pingt Supabase 2× pro Woche, damit das Gratis-Projekt nicht pausiert

## Einrichtung

Einmalig `setup.bat` (Windows) bzw. `python setup.py` ausführen. Das Skript
legt die Datenbank an, erstellt dein App-Konto, sperrt freie Registrierungen,
lädt den Code ins Repo und schaltet GitHub Pages ein.

## Einladungen

Neue Konten gibt es nur per Einladungslink (Mehr → „Freunde einladen“). Jeder Link gilt 14 Tage
für genau ein Konto. Die Prüfung passiert in der Datenbank (`007_invites.sql`), daher muss in
Supabase unter *Authentication → Sign In / Providers* „Allow new users to sign up“ eingeschaltet sein.

## Bier-Katalog

Der GitHub-Workflow **Katalog** lädt monatlich (und bei Änderungen in `scraper/`) Brauereien
und Biere in die Datenbank:

- **Wikidata** (CC0): Brauereien in Deutschland mit Ort, Bundesland, Koordinaten, Website und deren Biere
- **Open Food Facts** (ODbL): in Deutschland verkaufte Biere mit Barcode, Bild und Alkoholgehalt
  (täglicher CSV-Export), über den Markennamen den Brauereien zugeordnet

Eigene Einträge werden nie überschrieben. Ergebnis jedes Laufs: `catalog/report.md`.
Benötigt das Repo-Secret `SUPABASE_DB_PASSWORD`.

## Struktur

| Pfad | Inhalt |
| --- | --- |
| `src/pages/` | Seiten: Meine Biere, Scannen, Neues Bier, Bier, Brauereien, Brauerei, Karte, Mehr |
| `src/api.ts` | Datenzugriff (Supabase), Open Food Facts, Nominatim |
| `supabase/migrations/` | Datenbankschema (wird von GitHub Actions automatisch eingespielt) |
| `scraper/` | Katalog-Import (Wikidata, Open Food Facts) |
| `scripts/` | Datenbank-Verbindung und Migrationen für GitHub Actions |
| `.github/workflows/` | Deploy, Datenbank-Migrationen, Katalog, Keepalive |

## Lokal entwickeln

```
npm install
npm run dev
```
