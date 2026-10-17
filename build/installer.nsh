!include LogicLib.nsh

!macro customInstall
  ; Run the packaged app in setup-only mode so it updates the installing user's
  ; Claude Code settings without opening the HUD.
  ExecWait '"$INSTDIR\Agent Usage HUD.exe" --setup-claude' $0
  ${If} $0 == 2
    MessageBox MB_ICONEXCLAMATION|MB_OK "Claude Code setup was skipped because settings.json contains invalid JSON. Fix your .claude\settings.json file, then run the installer again."
  ${ElseIf} $0 == 3
    MessageBox MB_ICONEXCLAMATION|MB_OK "Claude Code already has a different status line. The installer left it unchanged. Merge the HUD command with your existing status line, then run the installer again."
  ${ElseIf} $0 == 4
    MessageBox MB_ICONEXCLAMATION|MB_OK "A Claude HUD status line helper already exists and was left unchanged. Review the agent-usage-hud-statusline.js file in your .claude folder, then run the installer again."
  ${ElseIf} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "Claude Code setup could not finish. Existing settings were left unchanged. Open Agent Usage HUD and check the Claude setup message."
  ${EndIf}
!macroend
