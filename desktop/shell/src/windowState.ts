/**
 * 창 위치 · 크기 · 최대화 · 모니터를 `userData/window.json` 에 기억한다.
 *
 * 다시 켤 때: 저장한 모니터(id)가 지금도 있고 창이 그 작업 영역에 걸치면 그 자리. 아니면(모니터를
 * 뺐다 · 해상도가 바뀌어 창이 화면 밖) 같은 크기로 주 모니터 가운데. 크기는 그 모니터 작업 영역보다
 * 크지 않게 줄인다. Electron 의 `screen` 은 앱이 준비된 뒤에만 쓸 수 있어 인자로 받는다. (StAnal 의 같은 파일)
 */
import * as fs from 'node:fs';

export interface Rect { x: number; y: number; width: number; height: number }

export interface SavedWindowState {
  bounds: Rect;
  maximized: boolean;
  displayId?: number;
  displayBounds?: Rect;
}

export interface DisplayLike { id: number; bounds: Rect; workArea: Rect }

export const DEFAULT_SIZE = { width: 1600, height: 960 };
const MIN_SIZE = { width: 900, height: 600 };

export function readWindowState(file: string): SavedWindowState | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const b = j?.bounds;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    if (!b || !num(b.x) || !num(b.y) || !num(b.width) || !num(b.height)) { return undefined; }
    return { bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, maximized: !!j.maximized,
      displayId: num(j.displayId) ? j.displayId : undefined, displayBounds: j.displayBounds };
  } catch { return undefined; }
}

export function writeWindowState(file: string, s: SavedWindowState): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, file);
  } catch { try { fs.unlinkSync(tmp); } catch { /* 무시 */ } }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function centered(size: { width: number; height: number }, area: Rect): Rect {
  const width = Math.max(MIN_SIZE.width, Math.min(size.width, area.width));
  const height = Math.max(MIN_SIZE.height, Math.min(size.height, area.height));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width, height,
  };
}

export interface Placement {
  bounds: Rect;
  maximized: boolean;
  /** 어디에 놓았는가(시험 · 로그) */
  where: 'saved' | 'primary-fallback' | 'default';
  displayId: number;
}

/**
 * 저장한 상태를 지금 모니터 구성에 놓는다.
 * 제목 표시줄을 잡을 수 있게: 창 윗부분(높이 40)이 어느 모니터의 작업 영역과 가로 100 이상 겹쳐야 한다.
 */
export function placeWindow(saved: SavedWindowState | undefined, displays: DisplayLike[], primary: DisplayLike): Placement {
  if (!saved) {
    return { bounds: centered(DEFAULT_SIZE, primary.workArea), maximized: false, where: 'default', displayId: primary.id };
  }
  const b = saved.bounds;
  const titleStrip: Rect = { x: b.x, y: b.y, width: b.width, height: 40 };
  const sameDisplay = saved.displayId !== undefined ? displays.find(d => d.id === saved.displayId) : undefined;
  const host = sameDisplay && overlap(titleStrip, sameDisplay.workArea) >= 100 * 40 * 0.5
    ? sameDisplay
    : displays.find(d => overlap(titleStrip, d.workArea) >= 100 * 20);
  if (host) {
    const area = host.workArea;
    const width = Math.max(MIN_SIZE.width, Math.min(b.width, area.width));
    const height = Math.max(MIN_SIZE.height, Math.min(b.height, area.height));
    return { bounds: { x: b.x, y: b.y, width, height }, maximized: saved.maximized, where: 'saved', displayId: host.id };
  }
  return { bounds: centered(b, primary.workArea), maximized: saved.maximized, where: 'primary-fallback', displayId: primary.id };
}
