# 냉간성형강 중심선 좌표 생성 알고리즘

## 모듈 파일: `cfs_centerline.py`

이 모듈은 **모든 열린(open) 냉간성형강 단면**의 중심선(centerline) 좌표를 생성한다.
C, Z, Sigma, Hat, Rack, L-angle 등 어떤 형상이든 동일한 3단계 파이프라인으로 처리한다.

---

## 핵심 알고리즘: 3단계 파이프라인

### 왜 이 방식인가?

냉간성형강 단면의 중심선 좌표를 만드는 방법은 크게 두 가지다:

1. **Fold-Line Path (절곡 경로 추적)**: 시작점에서 현재 방향(θ)을 유지하며 "직선 → 코너(호) → 직선 → ..." 순서로 추적
2. **Outer Corner → Offset → Fillet**: 외측면의 꼭짓점(sharp corner) 좌표를 먼저 정의하고, 안쪽으로 offset 후 코너에 필렛 적용

**방법 1은 실패하기 쉽다.** 특히 시그마(Σ) 단면처럼 90°가 아닌 경사 접힘이 있으면 각 코너의 꺾임 각도(±38.66° 등)를 수동으로 계산해야 하고, 부호(CW/CCW)를 한 군데라도 틀리면 형상이 완전히 망가진다.

**방법 2는 안정적이다.** 이미지/도면의 외측 치수를 그대로 XY 좌표로 변환하면 되고, 꺾임 각도는 알고리즘이 두 변의 방향벡터로부터 자동 계산한다. 90°든 38.66°든 코드가 알아서 처리한다.

---

### Step 1: 외측 꼭짓점 정의 (Outer Sharp Corners)

```
입력: 외측면의 sharp corner 좌표 리스트 [(x0,y0), (x1,y1), ...]
      경로 순서대로 나열 (한쪽 자유단에서 다른쪽 자유단까지)
```

**규칙:**
- 코너 R이 없다고 가정한 외측면(바깥면) 교차점의 좌표를 사용
- 이미지/도면의 **외측 치수**를 그대로 좌표로 변환
- 첫 점과 끝 점은 자유단(lip end 등)
- 경사 접힘도 단순히 두 점의 좌표로 표현하면 됨 (각도 계산 불필요)

**예시 - 시그마 단면 (8" × 2.5"):**
```python
outer_corners = [
    (0.0, -1.00),    # P0: 하단 립 끝
    (0.0, 0.0),      # P1: 하단 립-플랜지 코너
    (2.50, 0.0),     # P2: 하단 플랜지-웹 코너
    (2.50, 2.25),    # P3: 웹-시그마 경사 시작
    (2.00, 2.875),   # P4: 시그마 내측 하단 (경사 접힘!)
    (2.00, 5.125),   # P5: 시그마 내측 상단
    (2.50, 5.75),    # P6: 시그마-웹 경사 끝
    (2.50, 8.00),    # P7: 상부 웹-플랜지 코너
    (0.0, 8.00),     # P8: 상부 플랜지-립 코너
    (0.0, 7.125),    # P9: 상부 립 끝
]
```

**`outer_side` 파라미터 결정법:**
경로를 P0→P1→...→P_end 순서로 따라갈 때, 판의 바깥면이 진행방향의 왼쪽이면 `'left'`, 오른쪽이면 `'right'`.

| 단면 | outer_side | 이유 |
|------|-----------|------|
| C (웹 우측) | left | 바깥면이 왼쪽 |
| Z | right | Z의 방향 특성상 |
| Hat | right | 바깥면이 위쪽(우측) |
| Sigma | left | C와 동일 |
| L-angle | left | 바깥면이 왼쪽 |

---

### Step 2: t/2 Offset (외측 → 중심선)

```
입력: 외측 꼭짓점 좌표, 판 두께 t, outer_side
출력: 중심선 꼭짓점 좌표 (여전히 sharp corner)
```

**자유단 (첫점/끝점):**
해당 변의 법선 방향으로 t/2 이동

```
법선 = 진행방향을 90° 회전 (outer_side 방향으로)
offset 점 = 원래 점 + 법선 × t/2
```

**내부 꼭짓점:**
양쪽 변의 법선벡터 이등분선(bisector) 방향으로 이동

```
n1 = 이전 변의 외측 법선
n2 = 다음 변의 외측 법선
bisector = normalize(n1 + n2)
cos_half = dot(n1, bisector)
offset_dist = (t/2) / cos_half
중심선 점 = 외측 점 + bisector × offset_dist
```

**왜 `1/cos_half`를 곱하는가?**
두 평면이 각도 θ로 만날 때, 외측면에서 법선 방향 t/2를 유지하면서 교차점을 구하면 이등분선 위에서 `t/2 / cos(θ/2)` 거리에 있다. 90° 코너에서는 cos(45°) = 0.707이므로 offset = t/2 × 1.414.

---

### Step 3: r_c Fillet (중심선 코너에 원호 삽입)

```
입력: 중심선 sharp corner 좌표, 필렛 반경 r_c = R_inner + t/2, 분할 수 n_arc
출력: 최종 중심선 좌표 (원호 포함)
```

각 내부 꼭짓점에 대해:

```
1) u1 = normalize(이전점 - 꼭짓점)  # 꼭짓점→이전점 단위벡터
   u2 = normalize(다음점 - 꼭짓점)  # 꼭짓점→다음점 단위벡터

2) θ = acos(dot(u1, u2))           # 끼인각 (0~180°)
   cross = u1×u2                    # 회전 방향 판별

3) tan_dist = r_c / tan(θ/2)       # 접선점까지 거리

4) 안전장치: tan_dist > 인접 변 길이 × 0.45 이면 r_c 자동 축소

5) T1 = 꼭짓점 + u1 × tan_dist     # 이전변 위의 접선점
   T2 = 꼭짓점 + u2 × tan_dist     # 다음변 위의 접선점

6) bisector = normalize(u1 + u2)
   center = 꼭짓점 + bisector × (r_c / sin(θ/2))  # 호 중심

7) T1→T2를 n_arc 등분하여 호 좌표 생성
   호 방향: cross > 0이면 CW, cross < 0이면 CCW
```

**자유단 (첫/끝 점)은 필렛하지 않는다** — 립 끝 등은 원래 sharp edge.

---

### Step 4: 도심 이동

```python
# 선형 요소(중심선) 기반 도심
for each segment (i, i+1):
    L = length of segment
    mx, my = midpoint of segment
    sum_xL += mx * L
    sum_yL += my * L
    total_L += L

xc = sum_xL / total_L
yc = sum_yL / total_L

# 모든 좌표를 (xc, yc)만큼 평행이동
```

---

## 사용법

### 방법 1: 외측 꼭짓점 직접 지정 (가장 범용적)

```python
from cfs_centerline import ColdFormedSection

section = ColdFormedSection(
    outer_corners=[(x0,y0), (x1,y1), ...],
    t=0.0451,
    R_inner=0.09375,
    n_arc=10,
    outer_side='left',
    labels=["P0 설명", "P1 설명", ...],
)

coords = section.get_coords()        # [(x,y), ...] 도심 원점
print(section.summary())             # 요약 출력
section.to_csv("output.csv")         # CSV 출력
```

### 방법 2: 프리셋 팩토리 함수

```python
from cfs_centerline import make_c_section, make_z_section, make_hat_section

c = make_c_section(H=6.0, B=2.0, D=0.625, t=0.054, R=3/16)
z = make_z_section(H=8.0, B_top=2.5, B_bot=2.5, D=0.75, t=0.060, R=3/16)
hat = make_hat_section(H=3.0, B_top=4.0, B_bot=8.0, t=0.048, R=3/16)
```

### 방법 3: 코너별 개별 반경

```python
section = ColdFormedSection(
    outer_corners=[...],  # 5개 꼭짓점
    t=0.060,
    corner_radii=[0.25, 0.15, 0.25],  # 내부 코너 3개에 각각 다른 r_c
    n_arc=10,
    outer_side='left',
)
```

---

## 단면물성 계산

도심 원점 좌표가 생성된 후, AISI 중심선법으로 단면물성을 자동 계산한다:

```python
props = section.properties
# props['A']   : 단면적 = total_L × t
# props['Ix']  : X축 관성모멘트
# props['Iy']  : Y축 관성모멘트  
# props['Ixy'] : 관성상승모멘트
# props['total_L'] : 총 중심선 길이
```

관성모멘트 계산식 (각 세그먼트):
```
Ix_seg = t × L × [my² + (L² × sin²α) / 12]
Iy_seg = t × L × [mx² + (L² × cos²α) / 12]
```
여기서 mx, my = 세그먼트 중점, α = 세그먼트 각도

---

## 주의사항

1. **외측 치수 사용**: 반드시 외측면(바깥면) 기준 치수를 사용할 것. 중심선이나 내측 치수를 넣으면 결과가 틀림.
2. **R=0 가정**: 꼭짓점 좌표는 코너 R이 없는 sharp corner로 정의. R은 별도 파라미터로 처리.
3. **경로 순서**: 한쪽 자유단에서 다른쪽 자유단까지 연속적으로 나열.
4. **outer_side**: 잘못 지정하면 중심선이 바깥쪽으로 offset됨 → 형상이 커짐. 결과 형상이 원래보다 크면 반대로 바꿔볼 것.
5. **닫힌 단면 미지원**: 이 모듈은 열린 단면(open section) 전용. 닫힌 단면(closed, 예: 원형관, 각관)은 별도 처리 필요.
6. **Warping constant (Cw)**: 이 모듈에서는 계산하지 않음. CUFSM 등 전용 소프트웨어 사용 권장.
