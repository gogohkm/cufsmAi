# Codex 검증 작업 메모

## 목적

이 메모는 `코드검증프로세스.md` 기반의 정밀 코드 감사 작업을 다음 세션에서 바로 이어가기 위한 핸드오프 문서다.

검증 목표는 다음 3가지다.

1. AISI S100-16 기준과 설계식 구현이 실제로 일치하는지 확인
2. SI 입력 → US 내부 계산 → SI 표시 변환이 정확한지 확인
3. 단위계 혼용, 상태 의존, 숨겨진 가정 때문에 잘못된 설계 판단이 생기지 않는지 확인

중요:

- 검증 완료 전까지 런타임 코드는 수정하지 않는다.
- 발견 사항은 `코드검증프로세스.md`에만 누적 기록한다.
- 다음 세션도 같은 원칙을 유지한다.

## 현재 상태

- 기준 문서: `코드검증프로세스.md`
- 마지막 확정 항목: `F-040`
- 현재까지 누적된 발견 사항 수: 40건
- 기존 테스트 실행 기록:
  - `python -m unittest discover -s test\python -p "test_*.py"` 통과
  - `python test\python\test_design_verification.py` 통과
- 테스트는 통과하지만, 이미 문서화된 다수의 설계/통합 오류를 검출하지 못한다.

## 우선 읽을 파일

다음 세션 시작 시 이 순서로 읽는 것이 가장 빠르다.

1. `코드검증프로세스.md`
2. `CODEx_검증작업_메모.md`
3. 필요 시 `C:\Users\USER\.codex\skills\aisi-cold-formed-steel\SKILL.md`
4. 필요 시 AISI skill의 `data/INDEX.md`

## 지금까지 확인한 핵심 범주

### 1. AISI 설계식/적용범위 오류

- `aisi_s100.py` 자동 props/DSM 생성 경로가 코너 반경과 응력상태를 잘못 다룸
- `python/engine/dsm.py`가 모드 분류 없이 첫 곡선/첫 극소만으로 DSM 값을 추출
- `§H3` 구현이 `H3-1` 고정, 잘못된 `phi`, 잘못된 분모(`Mnfo` 대신 최종 `Mn`)를 사용
- 조합설계 약축 휨 `May`가 Chapter F 감소 없이 `Sy × Fy`로 처리됨
- 냉간가공 `§A3.3.2`가 적용 전제 확인 전에 `Fy → Fya`를 먼저 올림
- `special_topics.py`의 `shear_lag`, `block_shear`, `flange_curling`가 조항/식/저항계수 체계와 어긋남
- `shear.py`의 `web_crippling()`이 Table G5-2/G5-3 분기를 축약해 C/Z, fastened/unfastened, flange condition을 잃음
- `connections.py`, `lap_connection.py`에 Chapter J 식/보간/조항 매핑 오류 다수 존재

### 2. SI/US 변환 및 단위 혼용

- formula 문자열 변환이 일부 단위만 처리
- Lap 접합부 `fastener_dia` 변환 누락
- MCP는 사실상 US-only인데, UI는 SI 지원 구조라 경로별 해석 체계가 다름
- 보고서/검증 대시보드/요약 탭이 첫 경간만 읽거나 gravity 조합만 읽는 문제 존재

### 3. 통합/상태 의존성 문제

- `design_purlin` 경로의 결과가 WebView 상태 변수로 들어오지 않아 보고서/검증/트리뷰가 최신 결과를 반영하지 못함
- 저장/복원은 마지막 하중분석/설계 결과를 보존하지 않음
- MCP `aisi_design_*`, `generate_report`, `validate_design` 설명이 실제 구현 수준보다 강함
- MCP 도구 상당수가 현재 모델/기존 해석상태에 의존하지만 스키마상 드러나지 않음

## 다음 세션에서 바로 이어갈 작업

아직 검증이 끝난 것이 아니다. 다음 순서로 이어가는 것이 좋다.

1. `코드검증프로세스.md`의 마지막 항목 `F-040` 이후부터 계속 누적
2. 아직 덜 본 경로 우선 점검
   - `python/design/loads/required_strength.py` 남은 서비스성/자동설계 보조 분기
   - `python/design/loads/beam_analysis.py`의 하중복원/처짐/조합 연계
   - `src/webview/ProjectExplorerProvider.ts`의 요약값 출처
   - `webview/js/app.js` 보고서/검증/복원 경계의 나머지 입력
   - `src/mcp/server.ts`의 남은 도구 설명과 실제 구현 수준 차이
3. `Chapter F`, `G`, `H`, `I`, `J`, `L` 기준 문서와 남은 구현식을 계속 1:1 대조
4. 확정된 항목만 `코드검증프로세스.md`에 `F-041`부터 이어서 기록

## 작업 규칙

- 새 발견 사항은 반드시 아래 형식을 유지한다.
  - 상태
  - 분류
  - 심각도
  - 위치
  - 내용
  - 근거
  - 영향
  - 재현 방법 또는 검증 방법
- 추정만으로 기록하지 않는다.
- AISI 문서 대조가 필요한 경우 skill의 specification 파일을 우선 본다.
- commentary는 해석 보조용으로 사용하고, 강도 판단은 specification 우선이다.
- 코드 수정 제안은 해도 되지만, 실제 수정은 사용자가 별도로 요청한 뒤 진행한다.

## 주의사항

- 현재 워크트리에 이미 사용자가 만든 변경이나 untracked 문서가 있다.
- `코드검증프로세스.md`, `클로드코드검증프로세스.md`, `.codex-skill-staging/`는 임의로 정리하거나 삭제하지 않는다.
- 검증 단계에서는 git 정리, 리팩터링, 테스트 보강 커밋까지 하지 않는다.

## 재개용 한 줄 요약

다음 세션에서는 `코드검증프로세스.md`를 먼저 열고, `F-040` 다음 번호부터 남은 `beam_analysis / required_strength / MCP 설명 / 보고서-검증-트리 상태 경계`를 계속 대조하면 된다.
