; MyAgents NSIS Installer Hooks
; - PREINSTALL: Kill all MyAgents processes before file replacement
;   Prevents file-lock failures when updating node.exe / claude.exe / etc.

; Shared cleanup logic — kill all processes launched from our install directory,
; plus orphan SDK/MCP processes that reference .myagents in their command line.
; Uses ExecutablePath for install-dir processes (precise, matches the locked file)
; and CommandLine for orphans (SDK/MCP may be system node, not our binary).
!macro _MYAGENTS_KILL_PROCESSES
  DetailPrint "Cleaning up MyAgents background processes..."

  ; 1. Kill ALL processes whose executable lives under our install directory.
  ;    Covers node.exe (sidecar / MCP via bundled npx), claude.exe (SDK), and any future binaries.
  ;    Uses ExecutablePath — the actual on-disk binary — so we won't false-positive
  ;    on processes that merely mention our path in their arguments.
  nsExec::ExecToLog 'powershell -NoProfile -Command "$ErrorActionPreference=\"SilentlyContinue\"; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like \"$INSTDIR\*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'

  ; 2. Kill orphan SDK/MCP child processes that may use system node
  ;    (their executable is NOT under $INSTDIR, but their CommandLine references .myagents)
  nsExec::ExecToLog 'powershell -NoProfile -Command "$ErrorActionPreference=\"SilentlyContinue\"; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \"*claude-agent-sdk*\" -and $_.CommandLine -like \"*.myagents*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'
  nsExec::ExecToLog 'powershell -NoProfile -Command "$ErrorActionPreference=\"SilentlyContinue\"; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \"*.myagents\mcp\*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'

  ; Brief wait for processes to fully terminate and release file locks
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _MYAGENTS_KILL_PROCESSES

  ; Legacy cleanup: remove orphaned bun.exe from pre-0.2.0 installs (Bun→Node migration,
  ; v0.2.0). Recent builds bundle Node, not Bun; this just sweeps any ancient leftover.
  Delete "$INSTDIR\bun.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Kill all MyAgents processes before uninstall (same file-lock issue as update)
  !insertmacro _MYAGENTS_KILL_PROCESSES

  ; Legacy cleanup: remove orphaned bun.exe from pre-0.2.0 installs so it doesn't
  ; survive uninstall (the NSIS uninstaller only tracks files it installed).
  Delete "$INSTDIR\bun.exe"
!macroend
