#!/bin/bash
# A clean screen for recording the demo.
#
#   bash grace/demo-screen.sh clean     # strip the desktop down
#   bash grace/demo-screen.sh restore   # put everything back
#
# Every change is a user default that `restore` reverses. Nothing is deleted,
# no windows are closed — other apps are only hidden, so ⌘-Tab brings them back.

set -u
STATE="$HOME/.grace-demo-screen.state"
KEEP_APPS=("Google Chrome" "Terminal" "iTerm2" "Safari" "QuickTime Player")



case "${1:-}" in
  clean)
    # remember what to put back
    {
      echo "dock_autohide=$(defaults read com.apple.dock autohide 2>/dev/null || echo 0)"
      echo "desktop_icons=$(defaults read com.apple.finder CreateDesktop 2>/dev/null || echo 1)"
    } > "$STATE"

    echo "→ hiding desktop icons"
    defaults write com.apple.finder CreateDesktop -bool false && killall Finder 2>/dev/null

    echo "→ auto-hiding the Dock"
    defaults write com.apple.dock autohide -bool true
    defaults write com.apple.dock autohide-delay -float 1000    # keep it out of the frame
    killall Dock 2>/dev/null


    echo "→ hiding every app except: ${KEEP_APPS[*]}"
    KEEPLIST=$(printf '"%s",' "${KEEP_APPS[@]}"); KEEPLIST="{${KEEPLIST%,}}"
    osascript <<OSA 2>/dev/null
set keepers to $KEEPLIST
tell application "System Events"
  repeat with p in (every process whose visible is true and background only is false)
    if name of p is not in keepers then set visible of p to false
  end repeat
end tell
OSA

    echo
    echo "clean. record with ⌘⇧5 → Record Entire Screen (or Selected Portion)."
    echo "turn on Focus from the menu bar so notifications stay out of the take."
    echo "put it back with:  bash grace/demo-screen.sh restore"
    ;;

  restore)
    [ -f "$STATE" ] && . "$STATE"

    echo "→ desktop icons back"
    defaults write com.apple.finder CreateDesktop -bool true && killall Finder 2>/dev/null

    echo "→ Dock back"
    if [ "${dock_autohide:-0}" = "1" ]; then defaults write com.apple.dock autohide -bool true
    else defaults write com.apple.dock autohide -bool false; fi
    defaults delete com.apple.dock autohide-delay 2>/dev/null
    killall Dock 2>/dev/null


    rm -f "$STATE"
    echo
    echo "restored. hidden apps are still hidden — ⌘-Tab to bring them back."
    ;;

  *)
    echo "usage: bash grace/demo-screen.sh {clean|restore}"
    exit 1
    ;;
esac
