# Shield

Schlichter Desktop-Browser für Windows mit Werbe- und Trackerblocker, lokaler KI und einem isolierten Modus.

## Was drin ist

- **Blocker** für bekannte Werbe- und Tracking-Domains (Subdomains werden mitgeblockt)
- **Lokale KI** über [Ollama](https://ollama.com): Fragen zur Seite, Recherche, mehrstufige Aufgaben und ein Agent, der Seiten mit sichtbarem Cursor bedient
- **Aufgaben-Modus**: arbeitet Übungen auf Lernseiten selbstständig ab. Solche Automatisierung kann gegen die Nutzungsbedingungen der jeweiligen Seite verstoßen – Nutzung auf eigenes Risiko.
- **Isolierter Modus**: eigener Prozess mit Wegwerf-Profil, nach dem Schließen ist alles weg
- Startseite mit Fuji-Szene in Tageszeit-Farben und „Liquid Glass“-Oberfläche

Ehrlich gesagt: Ohne Proxy oder Tor sehen Webseiten weiterhin deine IP-Adresse.

Gebaut mit Electron.

## Starten

```powershell
npm install
npm start
```

Für die KI-Funktionen muss Ollama laufen, zum Beispiel mit `ollama pull qwen2.5:3b`. Für den Aufgaben-Modus nimmt Shield automatisch ein größeres Modell (7B und mehr), wenn eins installiert ist.

## Als EXE bauen

```powershell
npx electron-packager . Shield --platform=win32 --arch=x64 --out=dist --overwrite --prune=true --ignore="^/dist"
```

Die fertige `Shield.exe` liegt dann in `dist\Shield-win32-x64\`.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
