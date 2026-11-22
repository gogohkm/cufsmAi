/** desktop/host 의 공개 API. 시험 · CLI · (뒤에) 화면 다리와 Electron 껍데기가 이것만 쓴다. */
export { startHost, isOutStale, mcpConfigCandidates, defaultUserDataDir } from './loader';
export type { StartHostOptions, HostHandle, McpEndpoint, DesignerPanel, FileResult } from './loader';
export { createHeadlessPlatform, withScriptedAnswers } from './platform';
export type {
  HostPlatform, HeadlessPlatform, HeadlessPlatformOptions, NotifyRequest, PickRequest, InputRequest,
  FileDialogRequest, ProgressState, PlatformQuestion, ScriptedPlatform, ScriptedDialog,
} from './platform';
export type { WebviewInfo, WebviewResourceMapper } from './vscode';
export {
  startBridge, createBridgePlatform, defaultDocumentsDir, themeVariables, usedThemeVariables, missingThemeVariables,
  themeCss, injectWebviewHtml, rewriteCsp, rewriteResourceUrls, invalidConfigText, writeFailedText,
} from './bridge';
export type {
  StartBridgeOptions, BridgeHandle, BridgePlatform, BridgePlatformOptions, PendingQuestion, BridgeClaudeOptions,
  ClaudeStatus, ClaudeActionResult, ClaudeUiState, BridgeEvent, ThemeName,
} from './bridge';
