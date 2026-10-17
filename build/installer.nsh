!macro customInstall
  ; Run the packaged app in setup-only mode so it updates the installing user's
  ; Claude Code settings without opening the HUD.
  ExecWait '"$INSTDIR\Agent Usage HUD.exe" --setup-claude'
!macroend
