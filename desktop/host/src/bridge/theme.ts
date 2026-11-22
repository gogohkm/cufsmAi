/**
 * 웹뷰가 기대는 VS Code 테마 값.
 *
 * VS Code 는 웹뷰 `<html>` 에 `--vscode-*` 변수를, `<body>` 에 `vscode-dark` / `vscode-light` 클래스를 걸고,
 * 기본 스타일시트(글꼴 · 색 · 여백 · 링크 · 스크롤 막대)를 넣는다. 다리가 그 셋을 대신 넣는다.
 * 값은 VS Code 기본 테마(Dark Modern / Light Modern)의 색이다.
 *
 * 덮는 범위: StCFSD 웹뷰가 쓰는 변수 전부(38종 — `webview/css/theme.css` · `webview/js/**` · `src/webview/StcfsdPanel.ts`
 * 의 HTML 을 훑은 목록) + VS Code 가 늘 넣는 글꼴 변수 + 기본 스타일시트가 쓰는 변수. 빠진 것이 있으면
 * `host/build.mjs` 가 빌드를 멈추고 `host/test/bridge.mjs` 가 실패한다(`usedThemeVariables`).
 * 웹뷰의 상당수(theme.css 62곳)는 `var(--vscode-…)` 에 대체값이 없어, 정의가 빠지면 배경이 투명해지고 테두리가 사라진다.
 */

export type ThemeName = 'dark' | 'light';

const FONTS: Record<string, string> = {
  'font-family': '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
  'font-weight': 'normal',
  'font-size': '13px',
  'editor-font-family': 'Consolas, "Courier New", monospace',
  'editor-font-weight': 'normal',
  'editor-font-size': '14px',
  // `editor-fontFamily`(낙타 표기)도 웹뷰가 쓴다(app.js 의 코드 상자) — VS Code 는 두 꼴을 다 넣는다.
  'editor-fontFamily': 'Consolas, "Courier New", monospace',
};

const DARK: Record<string, string> = {
  'foreground': '#cccccc',
  'descriptionForeground': '#9d9d9d',
  'errorForeground': '#f85149',
  'focusBorder': '#0078d4',
  'editor-background': '#1f1f1f',
  'editor-foreground': '#cccccc',
  'editor-selectionBackground': '#264f78',
  'editorGroupHeader-tabsBackground': '#181818',
  'editorHoverWidget-background': '#202020',
  'editorHoverWidget-foreground': '#cccccc',
  'editorHoverWidget-border': '#454545',
  'editorWarning-foreground': '#cca700',
  'panel-border': '#2b2b2b',
  'input-background': '#313131',
  'input-foreground': '#cccccc',
  'input-border': '#3c3c3c',
  'inputValidation-errorBackground': '#5a1d1d',
  'inputValidation-errorForeground': '#f0f0f0',
  'inputValidation-errorBorder': '#be1100',
  'inputValidation-infoBackground': '#063b49',
  'inputValidation-infoForeground': '#f0f0f0',
  'inputValidation-warningBackground': '#352a05',
  'inputValidation-warningForeground': '#f0f0f0',
  'inputValidation-warningBorder': '#b89500',
  'button-background': '#0078d4',
  'button-foreground': '#ffffff',
  'button-hoverBackground': '#026ec1',
  'button-secondaryBackground': '#313131',
  'button-secondaryForeground': '#cccccc',
  'list-hoverBackground': '#2a2d2e',
  'textLink-foreground': '#4daafc',
  'textLink-activeForeground': '#4daafc',
  'textBlockQuote-background': '#2b2b2b',
  'textBlockQuote-border': '#616161',
  'textPreformat-foreground': '#d0d0d0',
  'textPreformat-background': '#3c3c3c',
  'charts-blue': '#3794ff',
  'charts-green': '#89d185',
  'charts-orange': '#d18616',
  'scrollbarSlider-background': '#79797966',
  'scrollbarSlider-hoverBackground': '#646464b3',
  'scrollbarSlider-activeBackground': '#bfbfbf66',
};

const LIGHT: Record<string, string> = {
  'foreground': '#3b3b3b',
  'descriptionForeground': '#3b3b3b',
  'errorForeground': '#f85149',
  'focusBorder': '#005fb8',
  'editor-background': '#ffffff',
  'editor-foreground': '#3b3b3b',
  'editor-selectionBackground': '#add6ff',
  'editorGroupHeader-tabsBackground': '#f8f8f8',
  'editorHoverWidget-background': '#f8f8f8',
  'editorHoverWidget-foreground': '#3b3b3b',
  'editorHoverWidget-border': '#c8c8c8',
  'editorWarning-foreground': '#bf8803',
  'panel-border': '#e5e5e5',
  'input-background': '#ffffff',
  'input-foreground': '#3b3b3b',
  'input-border': '#cecece',
  'inputValidation-errorBackground': '#f2dede',
  'inputValidation-errorForeground': '#3b3b3b',
  'inputValidation-errorBorder': '#be1100',
  'inputValidation-infoBackground': '#d6ecf2',
  'inputValidation-infoForeground': '#3b3b3b',
  'inputValidation-warningBackground': '#f6f5d2',
  'inputValidation-warningForeground': '#3b3b3b',
  'inputValidation-warningBorder': '#bf8803',
  'button-background': '#005fb8',
  'button-foreground': '#ffffff',
  'button-hoverBackground': '#0258a8',
  'button-secondaryBackground': '#e5e5e5',
  'button-secondaryForeground': '#3b3b3b',
  'list-hoverBackground': '#f2f2f2',
  'textLink-foreground': '#005fb8',
  'textLink-activeForeground': '#005fb8',
  'textBlockQuote-background': '#f8f8f8',
  'textBlockQuote-border': '#e5e5e5',
  'textPreformat-foreground': '#3b3b3b',
  'textPreformat-background': '#0000001f',
  'charts-blue': '#1a85ff',
  'charts-green': '#388a34',
  'charts-orange': '#d18616',
  'scrollbarSlider-background': '#64646466',
  'scrollbarSlider-hoverBackground': '#646464b3',
  'scrollbarSlider-activeBackground': '#00000099',
};

export function themeVariables(theme: ThemeName): Record<string, string> {
  return { ...FONTS, ...(theme === 'light' ? LIGHT : DARK) };
}

/**
 * VS Code 가 모든 웹뷰에 넣는 기본 스타일(`webview/browser/pre/index.html` 의 defaultStyles)을 옮긴 것.
 * 웹뷰 자기 스타일(`theme.css`)이 뒤에 와서 덮는다. html 배경은 VS Code 에서 편집기 배경이 비쳐 보이는 자리다.
 */
const DEFAULT_STYLES = `
html{background-color:var(--vscode-editor-background);scrollbar-color:var(--vscode-scrollbarSlider-background) var(--vscode-editor-background);}
body{overscroll-behavior-x:none;background-color:transparent;color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-weight:var(--vscode-font-weight);font-size:var(--vscode-font-size);margin:0;padding:0 20px;}
img,video{max-width:100%;max-height:100%;}
a,a code{color:var(--vscode-textLink-foreground);}
a:hover{color:var(--vscode-textLink-activeForeground);}
a:focus,input:focus,select:focus,textarea:focus{outline:1px solid -webkit-focus-ring-color;outline-offset:-1px;}
code{font-family:var(--vscode-editor-font-family);color:var(--vscode-textPreformat-foreground);background-color:var(--vscode-textPreformat-background);padding:1px 3px;border-radius:4px;}
pre code{padding:0;}
blockquote{background:var(--vscode-textBlockQuote-background);border-color:var(--vscode-textBlockQuote-border);}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-corner{background-color:var(--vscode-editor-background);}
::-webkit-scrollbar-thumb{background-color:var(--vscode-scrollbarSlider-background);}
::-webkit-scrollbar-thumb:hover{background-color:var(--vscode-scrollbarSlider-hoverBackground);}
::-webkit-scrollbar-thumb:active{background-color:var(--vscode-scrollbarSlider-activeBackground);}
`;

/** `:root{--vscode-…}` + 기본 스타일 한 덩어리 */
export function themeCss(theme: ThemeName): string {
  const vars = themeVariables(theme);
  const body = Object.entries(vars).map(([k, v]) => `--vscode-${k}:${v};`).join('');
  return `:root{${body}color-scheme:${theme};}${DEFAULT_STYLES}`;
}

/** body 에 걸 클래스(VS Code 와 같은 이름) */
export function themeBodyClass(theme: ThemeName): string {
  return theme === 'light' ? 'vscode-light' : 'vscode-dark';
}

/**
 * 소스 글에서 쓰는 `--vscode-*` 이름(앞의 `--vscode-` 를 뗀 것). 빌드 · 시험이 웹뷰 소스와 패널 HTML 을 넣어 부른다.
 * 정의(`--vscode-x:`)가 아니라 쓰임(`var(--vscode-x` · `getPropertyValue('--vscode-x')`)을 모은다.
 */
export function usedThemeVariables(texts: string[]): string[] {
  const names = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/--vscode-([a-zA-Z0-9-]+)/g)) { names.add(m[1]); }
  }
  return [...names].sort();
}

/** 쓰는데 정의가 없는 이름(두 테마 모두 보고) */
export function missingThemeVariables(used: string[]): Array<{ theme: ThemeName; name: string }> {
  const out: Array<{ theme: ThemeName; name: string }> = [];
  for (const theme of ['dark', 'light'] as ThemeName[]) {
    const vars = themeVariables(theme);
    for (const name of used) { if (!(name in vars)) { out.push({ theme, name }); } }
  }
  return out;
}
