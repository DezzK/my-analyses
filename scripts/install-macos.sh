#!/bin/bash
# Installs «Мои анализы» on a Mac, or brings it to the newest version: the build for this Mac from
# the latest release, checked the way the app checks its own updates (SHA-512 from the feed, then
# the signature against the release certificate). The release script fills in the @…@ values.
#
#   @INSTALL_COMMAND@
set -euo pipefail

@REPLACE_BUNDLE@

feed_url='@FEED_URL@'
app_id='@APP_ID@'
requirement='@REQUIREMENT@'

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo "Этот процессор не поддерживается: $(uname -m)" >&2; exit 1 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL "$feed_url" -o "$work/feed.json"
version="$(plutil -extract version raw -o - "$work/feed.json")"
url="$(plutil -extract "builds.$arch.url" raw -o - "$work/feed.json")"
sha512="$(plutil -extract "builds.$arch.sha512" raw -o - "$work/feed.json")"

echo "Скачиваю «Мои анализы» $version…"
curl -fL --progress-bar "$url" -o "$work/app.zip"
if [ "$(shasum -a 512 "$work/app.zip" | cut -d ' ' -f 1)" != "$sha512" ]; then
  echo "Файл повредился при загрузке, запустите установку ещё раз." >&2
  exit 1
fi

ditto -x -k "$work/app.zip" "$work/unpacked"
app="$(find "$work/unpacked" -maxdepth 1 -name '*.app' | head -n 1)"
if ! codesign --verify --deep --strict -R "=$requirement" "$app"; then
  echo "Приложение подписано не тем ключом: установка отменена." >&2
  exit 1
fi

target_dir=/Applications
if [ ! -w "$target_dir" ]; then
  target_dir="$HOME/Applications"
  mkdir -p "$target_dir"
fi
target="$target_dir/$(basename "$app")"

if osascript -e "application id \"$app_id\" is running" | grep -q true; then
  echo "Закрываю запущенное приложение…"
  osascript -e "tell application id \"$app_id\" to quit"
  while osascript -e "application id \"$app_id\" is running" | grep -q true; do sleep 1; done
fi

if ! replace_bundle "$target" "$app"; then
  echo "Не удалось положить приложение в папку $target_dir." >&2
  exit 1
fi
echo "Готово: «Мои анализы» $version в папке $target_dir."
open "$target"
