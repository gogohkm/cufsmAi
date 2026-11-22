/**
 * 화면이 없을 때 설계 패널의 웹뷰 대역.
 *
 * StCFSD 의 호스트는 웹뷰가 할 일 몇 가지를 기다린다. 화면이 없으면(headless) 아무도 답하지 않아
 * 그 길이 멈춘다. 대역은 그중 둘만 웹뷰처럼 답한다 — 계산은 하지 않는다.
 *
 * 1. `webviewReady` — 웹뷰가 뜨면 보내는 첫 메시지. 호스트가 기본 단면(립 C)을 만든다
 *    (`StcfsdPanel._initializeWithDefaultSection`). VS Code 에서 패널을 연 직후와 같은 상태가 된다.
 * 2. `collectDesignData` → `designDataCollected` — 저장(`saveProject`) 때 호스트가 웹뷰에 설계 탭 입력을
 *    묻는다(`webview/js/app.js` 의 같은 case). 설계 탭 입력(부재 길이 · 하중 · 설계 Fy …)은 K2 전까지
 *    **웹뷰에만 있다** — 호스트에도 MCP 에도 없다. 그래서 대역은 새로 모을 수 없고, 마지막으로 받은
 *    `restoreDesignInputs`(파일을 열 때 호스트가 보낸 입력)와 `lapConnectionResult` 를 그대로 돌려준다.
 *    파일을 연 적이 없으면 입력은 null 이다(호스트는 `designInputs: null` 로 쓴다).
 *
 *    그 사이 MCP 로 설계 · 하중을 돌렸어도 그 조건은 입력 칸에 들어가지 않는다 — 저장본의 `designInputs` 는
 *    연 파일의 것 그대로다(결과 `designResult` · `loadAnalysis` 는 호스트가 지금 것으로 쓴다). 저장할 때마다
 *    이것을 알리는 주의 문장을 만든다(`onSaveNotice`, 적재기가 기록하고 `saveProject` 의 결과에 싣는다).
 *
 * 화면 캡처(`captureSection`)에는 답하지 않는다 — 그리는 화면이 없다. MCP `get_section_preview` 는
 * 호스트의 5 초 시간 제한 오류를 그대로 돌려준다. S2 에서 진짜 웹뷰가 붙으면 대역은 떼어 낸다.
 */
import type { WebviewHub } from './vscode/webview';

interface PanelMessage { command?: string; data?: unknown }

/** 입력 칸에 들어갔어야 할 조건이 바뀌었음을 알리는 호스트 → 웹뷰 메시지(대역은 칸을 고치지 못한다) */
const INPUT_AFFECTING = new Set([
  'modelLoaded', 'designResult', 'designPurlinResult', 'loadAnalysisComplete', 'lapConnectionResult',
  'connectionResult', 'designDsmPrepared',
]);

export interface ScreenlessStandIn {
  /** 마지막으로 받은 설계 입력(저장 때 돌려줄 것) */
  readonly designInputs: unknown;
  /** 곧 이 파일을 연다 — 입력의 출처를 적어 둔다(적재기의 openProject). 열기가 끝나면 restoreDone() */
  expectRestore(file: string): void;
  /** 열기가 끝났다 — 열기 중에 호스트가 다시 보낸 결과(designResult 등)는 바뀐 것으로 치지 않는다 */
  restoreDone(): void;
  /** 저장 때 만든 주의 문장(입력을 새로 모으지 못했다) */
  onSaveNotice?: (notice: string) => void;
  dispose(): void;
}

export function attachScreenlessStandIn(hub: WebviewHub, designerId: string, log: (line: string) => void): ScreenlessStandIn {
  let designInputs: unknown = null;
  let lapResult: unknown = null;
  let pendingSource: string | undefined;
  let source: string | undefined;
  /** 입력을 받은 뒤 호스트가 보낸, 입력 칸에 들어갔어야 할 메시지 */
  const changedSince = new Set<string>();
  let disposed = false;
  let restoring = false;
  /** 이번 열기에서 입력을 실제로 받았는가(열기가 실패하면 바뀐 것 기록을 지우지 않는다) */
  let restoredThisOpen = false;

  const saveNotice = (): string => {
    const head = '설계 탭 입력은 화면(웹뷰)에만 있어 새로 모으지 못했다';
    if (source === undefined) {
      return `${head} — 연 파일이 없어 designInputs 를 null 로 쓴다(Lap 결과 ${lapResult ? '있음' : '없음'})`;
    }
    const changed = [...changedSince];
    return `${head} — ${source} 을(를) 열 때의 입력을 그대로 쓴다`
      + (changed.length ? `. 그 뒤 호스트가 바꾼 것(${changed.join(', ')})의 조건은 입력 칸에 들어가지 않았다 — 저장본의 designInputs 는 그것을 담지 않는다(K2 전의 한계)` : '');
  };

  const self: ScreenlessStandIn = {
    get designInputs() { return designInputs; },
    expectRestore(file) { pendingSource = file; restoring = true; restoredThisOpen = false; },
    restoreDone() { restoring = false; pendingSource = undefined; if (restoredThisOpen) { changedSince.clear(); } },
    dispose() { disposed = true; sub.dispose(); },
  };

  const sub = hub.onDidPostMessage.event(({ id, message }) => {
    if (id !== designerId || disposed) { return; }
    const m = (message ?? {}) as PanelMessage;
    switch (m.command) {
      case 'restoreDesignInputs':
        designInputs = m.data ?? null;
        source = pendingSource ?? source ?? '(알 수 없는 파일)';
        changedSince.clear();
        if (restoring) { restoredThisOpen = true; }
        break;
      case 'resultsCleared':
        // 다른 파일을 열기 직전 — 웹뷰도 Lap 결과를 지운다.
        lapResult = null;
        break;
      case 'collectDesignData': {
        const notice = saveNotice();
        log(`[host] 저장 주의: ${notice}`);
        self.onSaveNotice?.(notice);
        // 웹뷰처럼 다음 차례에 답한다(호스트의 postMessage 안에서 곧바로 되부르지 않게).
        setImmediate(() => {
          if (disposed) { return; }
          hub.deliver(designerId, {
            command: 'designDataCollected',
            data: { __stcfsd_collect: 2, designInputs, lapResult },
          });
        });
        break;
      }
      default:
        break;
    }
    if (m.command === 'lapConnectionResult') { lapResult = m.data ?? null; }
    if (m.command && INPUT_AFFECTING.has(m.command) && source !== undefined && !restoring) { changedSince.add(m.command); }
  });

  log('[host] 화면 없음 — 설계 패널에 웹뷰 대역을 붙였다(webviewReady · collectDesignData 에만 답한다)');
  hub.deliver(designerId, { command: 'webviewReady' });
  return self;
}
