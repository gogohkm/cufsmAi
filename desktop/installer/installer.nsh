; StCFSD — electron-builder NSIS 에 더하는 것(electron-builder.config.cjs 의 nsis.include). 한국어 주석.
;
; customUnInstall — 제거 프로그램이 설치 폴더의 파일을 지우기 **바로 앞**(uninstaller.nsh 의 un.Uninstall 구역)에 들어간다.
;   이 설치본이 Claude Desktop 설정에 등록한 항목(mcpServers.stcfsd)을 지운다(V5-05). 제목 표시줄의 「끊기」와 같은 도우미를
;   설치본의 StCFSD.exe 를 node 로(ELECTRON_RUN_AS_NODE=1) 돌려 부른다 — 이 항목과 **같을 때만** 지우고 다른 항목은 건드리지 않는다.
;   조용히(nsExec — 콘솔 창 없음), 15 초 제한, 결과와 상관없이 제거는 계속된다.
;   덮어 설치(새 판이 옛 판의 제거 프로그램을 --updated 로 부름)에서는 하지 않는다 — 설치 자리가 같아 등록이 그대로 맞다.
;   %APPDATA%\StCFSD(설정 · 창 위치 · 로그 · mcp\ 의 포트 파일과 MCP 클라이언트 기록 stcfsd-mcp-port.client-*)는 지우지 않는다
;   (deleteAppDataOnUninstall: false).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfFileExists "$INSTDIR\resources\app\uninstall\disconnect.js" 0 stcfsd_no_disconnect
      DetailPrint "Claude Desktop 설정에서 StCFSD 등록을 지웁니다(이 설치본의 항목일 때만)"
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1") i.r0'
      nsExec::Exec /TIMEOUT=15000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app\uninstall\disconnect.js"'
      Pop $0
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0) i.r0'
    stcfsd_no_disconnect:
  ${endIf}
!macroend
