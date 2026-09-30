# My Analyses («Мои анализы»)

A desktop app for macOS, Windows and Linux that keeps a family's lab results: it imports them from lab
accounts, shows them as tables and charts, and builds reports for a doctor, printed or as PDF. The
interface is in Russian.

- Imports from a [KDL](https://kdl.ru) account through a built-in browser: you sign in yourself, and the
  app never stores passwords. The lab's original forms are kept as they are. Results can also be typed
  in by hand.
- A catalog of analytes: synonyms and lab codes, units with conversions, and reference ranges that
  depend on sex, age, pregnancy and the menstrual cycle.
- A table and a chart for every analyte, and reports built from templates.
- Everything stays on your computer, with backups in a folder of your choice. The app goes online only
  to the labs' sites and here, for updates.

## Installing

The builds are in the [latest release](https://github.com/DezzK/my-analyses/releases/latest).

- **macOS**: one command in Terminal, which also installs a newer version over an older one:

  ```bash
  curl -fsSL https://github.com/DezzK/my-analyses/releases/latest/download/install.sh | bash
  ```

- **Windows**: download and run the `…-setup.exe` installer. Windows warns about an unknown publisher:
  choose "More info", then "Run anyway".
- **Linux**: download the `.AppImage` file, make it executable (`chmod +x`) and run it.

From then on the app updates itself. A Mac accepts an update only when it is signed with the same key as
the app already installed.

## Disclaimer

My Analyses is not a medical device. It makes no diagnosis and does not replace a doctor: its marks of
deviation only compare a result with the lab's and the catalog's reference ranges, and they can be
wrong.

## Development

Electron, React and SQLite. The commands and the layout of the project are in [CLAUDE.md](CLAUDE.md).

```bash
npm ci
npm run dev
npm run check
```
