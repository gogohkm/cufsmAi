/**
 * 화면이 없을 때 설계 패널의 웹뷰 대역.
 *
 * StCFSD 의 호스트는 웹뷰가 뜬 것을 기다린다. 화면이 없으면(headless) 아무도 답하지 않아 그 길이 멈춘다.
 * 대역은 웹뷰가 처음 보내는 `webviewReady` 하나만 낸다 — 호스트가 기본 단면(립 C)을 만든다
 * (`StcfsdPanel._initializeWithDefaultSection`). VS Code 에서 패널을 연 직후와 같은 상태가 된다. 계산은 하지 않는다.
 *
 * K2 뒤(docs/implementation/20261123-k2-design.md §9): 설계 · 하중 · 접합 입력은 호스트의 검토 상태에 있다. 저장은 화면에 묻지 않고
 * 상태로 `.csd` 1.4 를 쓴다(호스트가 `collectDesignData` 를 더 보내지 않는다). 그래서 예전의 「마지막으로 연 파일의 입력을 돌려주고
 * 그 뒤 MCP 가 한 것은 못 담는다고 알리는」 일(저장 주의)은 없어졌다.
 *
 * 화면 캡처(`captureSection`)에는 답하지 않는다 — 그리는 화면이 없다. MCP `get_section_preview` 는
 * 호스트의 5 초 시간 제한 오류를 그대로 돌려준다.
 */
import type { WebviewHub } from './vscode/webview';

export interface ScreenlessStandIn {
  dispose(): void;
}

export function attachScreenlessStandIn(hub: WebviewHub, designerId: string, log: (line: string) => void): ScreenlessStandIn {
  log('[host] 화면 없음 — 설계 패널에 웹뷰 대역을 붙였다(webviewReady 만 낸다)');
  hub.deliver(designerId, { command: 'webviewReady' });
  return { dispose() { /* 받는 것이 없다 */ } };
}
