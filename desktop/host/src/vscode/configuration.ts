/**
 * workspace.getConfiguration — 기본값은 저장소 `package.json` 의 `contributes.configuration`
 * (StCFSD 는 지금 비어 있다), 사용자 값은 `<userDataDir>/settings.json`, 그 위에 시작 덮어쓰기.
 * 키는 VS Code 와 같이 평평하게 적는다(`"python.defaultInterpreterPath": "C:\\…\\python.exe"`).
 *
 * StCFSD 호스트가 읽는 설정은 하나다 — `python.defaultInterpreterPath`(`src/extension.ts`
 * `getPythonPath`, 확장 폴더에 `.venv` 가 없을 때). 설치본은 이것으로 묶어 넣은 python.exe 를 가리킨다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from './events';
import { ConfigurationTarget } from './types';

export interface ConfigurationChangeEvent {
  affectsConfiguration(section: string, scope?: unknown): boolean;
}

export class ConfigurationStore {
  private readonly defaults: Record<string, unknown> = {};
  private user: Record<string, unknown> = {};
  readonly onDidChange = new EventEmitter<ConfigurationChangeEvent>();

  constructor(
    packageJsonPath: string,
    private readonly settingsFile: string,
    /** 시작 시 덮어쓸 값(파일에 쓰지 않는다). 시험·CLI 용 */
    private readonly overrides: Record<string, unknown> = {},
  ) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const conf = pkg?.contributes?.configuration;
      for (const block of Array.isArray(conf) ? conf : [conf]) {
        for (const [key, spec] of Object.entries<any>(block?.properties ?? {})) {
          if (spec && 'default' in spec) { this.defaults[key] = spec.default; }
        }
      }
    } catch (err) {
      console.warn(`[vscode-shim] 설정 기본값을 읽지 못했다: ${packageJsonPath}`, err);
    }
    this.user = this.readUser();
  }

  private readUser(): Record<string, unknown> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
      return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
  }

  private lookup(key: string): { found: boolean; value: unknown } {
    if (key in this.overrides) { return { found: true, value: this.overrides[key] }; }
    if (key in this.user) { return { found: true, value: this.user[key] }; }
    if (key in this.defaults) { return { found: true, value: structuredClone(this.defaults[key]) }; }
    return { found: false, value: undefined };
  }

  /** 지금 값(덮어쓰기 > 사용자 > 기본). 적재기가 확인용으로 읽는다 */
  value<T>(key: string): T | undefined { return this.lookup(key).value as T | undefined; }

  section(section?: string) {
    const prefix = section ? `${section}.` : '';
    const store = this;
    const full = (key: string) => `${prefix}${key}`;
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const r = store.lookup(full(key));
        if (r.found && r.value !== undefined) { return r.value as T; }
        // 'a.b' 가 객체 설정의 안쪽일 수 있다.
        const dot = key.lastIndexOf('.');
        if (dot > 0) {
          const parent = store.lookup(full(key.slice(0, dot)));
          if (parent.found && parent.value && typeof parent.value === 'object') {
            const inner = (parent.value as Record<string, unknown>)[key.slice(dot + 1)];
            if (inner !== undefined) { return inner as T; }
          }
        }
        return defaultValue;
      },
      has(key: string): boolean { return store.lookup(full(key)).found; },
      inspect<T>(key: string) {
        const k = full(key);
        return {
          key: k,
          defaultValue: store.defaults[k] as T | undefined,
          globalValue: store.user[k] as T | undefined,
          workspaceValue: undefined as T | undefined,
          workspaceFolderValue: undefined as T | undefined,
        };
      },
      async update(key: string, value: unknown, _target?: ConfigurationTarget | boolean): Promise<void> {
        store.write(full(key), value);
      },
    };
  }

  write(key: string, value: unknown): void {
    if (value === undefined) { delete this.user[key]; } else { this.user[key] = value; }
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, `${JSON.stringify(this.user, null, 2)}\n`, 'utf8');
    this.onDidChange.fire({
      affectsConfiguration: (section: string) => key === section || key.startsWith(`${section}.`),
    });
  }
}
