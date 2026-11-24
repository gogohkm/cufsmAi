(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StcfsdDesignState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // ─────────────────────────────────────────────────────────────────────────
    // 입력 칸 한 표(W3 · V4-09 · K2-1): .csd 저장 키, DOM id, 단위 종류, 종류, 그리고 K2 의 상태 열(meta).
    // 단위 전환(app.js refreshUnits)과 저장 · 복원이 이 표 하나를 쓴다 — 단위가 있는 <input> 은
    // 반드시 여기 있어야 한다(test/webview/design_state_v13_contract.js 가 HTML 을 읽어 확인).
    // 값은 언제나 US 내부값으로 저장한다. 빈 칸은 null(= 입력 없음 — 지어낸 값이 아님, V4-06/07).
    // kind: num(수) · sel(선택) · chk(체크) · list(쉼표 목록) · raw(단위 없는 수를 표시값 그대로)
    //
    // meta(다섯째 열, K2-1 — 아직 아무도 쓰지 않는다. 설계: docs/implementation/20261123-k2-design.md §2):
    //   owner  'case'   호스트의 검토 상태(CaseState)가 주인
    //          'mirror' 다른 키의 거울(mirrorOf) — 상태에는 하나만, 1.3 모양에는 같은 값으로 쓴다
    //          'model'  호스트 모델이 주인(해석 조건 · 템플릿 · E/ν/G) — 상태에 두 벌로 두지 않는다
    //          'view'   보기 설정(결과에 쓰이지 않음)
    //   group  묶음(재료 · 부재 · 하중 · 데크 · 설계 · 웹 크리플링 · 옵션 · 소성 · 진동 · 랩 · 접합 · 템플릿 · 해석)
    //   def    처음 값 — **지금 화면의 처음 값 그대로**(손으로 정한 공학 기본값 44 개 포함, 값을 바꾸지 않는다).
    //          단위 있는 수는 SI 화면에 적힌 수(화면이 SI 로 시작하므로) — US 값은 defaultValue() 가 화면과 같은 식
    //          (표시값 / 계수)으로 만든다. null = 빈 칸. model 키는 null(모델에서 온다)
    //   src    처음 값의 출처: 'page'(HTML · JS 에 적힌 값) · 'steel'(src/webview/steelGrades.ts 의 SGC400) ·
    //          'blank' · 'model'
    //   inv    바뀌면 무엇이 낡나(K2 의 규칙): 'load'(② 탭 — 하중 해석부터) · 'design'(① · ③ 탭) ·
    //          'analysis-at-run'(해석 조건 — 「해석 실행」 때 호스트가) · 'connection'(④ 탭 — 결정 7, 지금 화면은 안 함: D-4) ·
    //          'none'(보기 · 진동)
    //   opts   선택지(sel) — 화면의 <option value> 차례 그대로(시험이 화면과 대조)
    // ─────────────────────────────────────────────────────────────────────────
    const _C = (group, def, inv, extra) => Object.assign({ owner: 'case', group, def, src: def == null ? 'blank' : 'page', inv }, extra || {});
    const _M = (group, inv) => ({ owner: 'model', group, def: null, src: 'model', inv });
    const _MIR = (group, mirrorOf, inv) => ({ owner: 'mirror', group, mirrorOf, def: null, src: 'mirror', inv });
    const _V = (def, inv) => ({ owner: 'view', group: 'view', def, src: 'page', inv: inv || 'none' });
    const _STEEL = { src: 'steel' };
    const STEEL_GRADE_OPTS = ['', 'SGC340', 'SGC400', 'SGC440', 'SGC490', 'SGC570', 'A653-33', 'A653-50', 'A653-80'];
    const FIELDS = [
        // 재료 · 설계 방법
        ['fy', 'design-fy', 'stress', 'num', _C('material', 295, 'design', _STEEL)],
        ['fu', 'design-fu', 'stress', 'num', _C('material', 400, 'design', _STEEL)],
        ['designMethod', 'select-design-method', null, 'sel', _C('method', 'LRFD', 'design', { opts: ['LRFD', 'ASD'] })],
        ['memberType', 'select-member-type', null, 'sel', _C('member', 'roof-purlin', 'load',
            { opts: ['roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud', 'flexure', 'compression', 'combined', 'tension'] })],
        ['presteelGrade', 'input-steel-grade', null, 'sel', _C('material', 'SGC400', 'design', { src: 'steel', opts: STEEL_GRADE_OPTS })],
        ['fyLoad', 'input-fy', 'stress', 'num', _MIR('material', 'fy', 'design')],
        ['fuPre', 'input-fu', 'stress', 'num', _MIR('material', 'fu', 'design')],
        ['inputE', 'input-E', 'stress', 'num', _M('material', 'design')],
        ['inputG', 'input-G', 'stress', 'num', _M('material', 'design')],
        ['inputV', 'input-v', null, 'num', _M('material', 'design')],
        ['plasticFy', 'plastic-fy', 'stress', 'num', _MIR('plastic', 'fy', 'design')],
        // 부재 구성 (경간 표는 따로)
        ['spanType', 'select-span-type', null, 'sel', _C('member', 'cont-3', 'load', { opts: ['simple', 'cantilever', 'cont-2', 'cont-3', 'cont-4', 'cont-n'] })],
        ['nSpans', 'config-n-spans', null, 'num', _C('member', 5, 'load')],
        ['spacing', 'config-spacing', 'length_ft', 'num', _C('member', 1.0, 'load')],
        // 하중
        ['loadD', 'load-D-psf', 'pressure', 'num', _C('loads', 0.3, 'load')],
        ['loadLr', 'load-Lr-psf', 'pressure', 'num', _C('loads', 1.0, 'load')],
        ['loadS', 'load-S-psf', 'pressure', 'num', _C('loads', 0.5, 'load')],
        ['loadWu', 'load-Wu-psf', 'pressure', 'num', _C('loads', 1.0, 'load')],
        ['loadWp', 'load-Wp-psf', 'pressure', 'num', _C('loads', 0, 'load')],
        ['loadL', 'load-L-psf', 'pressure', 'num', _C('loads', 0, 'load')],
        ['chkPatternLoading', 'chk-pattern-loading', null, 'chk', _C('loads', true, 'load')],
        ['chkLrReduced', 'chk-lr-reduced', null, 'chk', _C('loads', false, 'load')],
        ['spanIxIn4', 'span-Ix-list', 'inertia', 'list', _C('loads', null, 'load')],
        // 데크 · 가새 · §I6.2.1
        ['deckType', 'select-deck-type', null, 'sel', _C('deck', 'none', 'load', { opts: ['through-fastened', 'standing-seam', 'none'] })],
        ['deckTPanel', 'deck-t-panel', 'thickness', 'num', _C('deck', 0.5, 'load')],
        ['deckFastenerSpacing', 'deck-fastener-spacing', 'length', 'num', _C('deck', 300, 'load')],
        ['deckKphiOverride', 'deck-kphi-override', 'rotStiff', 'num', _C('deck', null, 'load')],
        ['deckKxOverride', 'deck-kx-override', 'latStiff', 'num', _C('deck', null, 'load')],
        ['bracePointsFt', 'brace-points', 'length_ft', 'list', _C('deck', null, 'load')],
        ['chkI621Confirmed', 'chk-i621-confirmed', null, 'chk', _C('deck', false, 'load')],
        // 계약 §6.3: 랩 구속의 진술(사람이 밝힌다 — 처음 값 없음 = 밝히지 않음). 퍼린 랩 구간과 랩 도구가 같이 쓴다; 랩 탭의 칸은 거울
        ['lapRestrained', 'chk-lap-restrained', null, 'chk', _C('lap', false, 'design')],
        ['lapRestrainedLap', 'chk-lap-restrained-lap', null, 'chk', _MIR('lap', 'lapRestrained', 'design')],
        ['deckInsulationIn', 'deck-insulation', 'length', 'num', _C('deck', null, 'load')],
        ['deckRTested', 'deck-R-tested', null, 'num', _C('deck', null, 'load')],
        // 설계 길이 · 계수 · 소요강도 (소요강도 칸은 ② 탭에 있다 — 바꾸면 하중 해석부터 낡는다: 지금 규칙)
        ['KxLx', 'design-KxLx', 'length', 'num', _C('design', 3000, 'design')],
        ['KyLy', 'design-KyLy', 'length', 'num', _C('design', 3000, 'design')],
        ['KtLt', 'design-KtLt', 'length', 'num', _C('design', 3000, 'design')],
        ['Lb', 'design-Lb', 'length', 'num', _C('design', 3000, 'design')],
        ['Cb', 'design-Cb', null, 'num', _C('design', 1.0, 'design')],
        ['designLbPos', 'design-Lb-pos', 'length', 'num', _C('design', 0, 'design')],
        ['designCbPos', 'design-Cb-pos', null, 'num', _C('design', 1.0, 'design')],
        ['Cmx', 'design-Cmx', null, 'num', _C('design', 1.00, 'design')],
        ['Cmy', 'design-Cmy', null, 'num', _C('design', 1.00, 'design')],
        // 계약 §6.4(엔진 3e7ce43): 주지 않은 소요는 0 이 아니다 — 처음 값은 비움, 비면 요청에 넣지 않는다(엔진: 주 소요가 없으면 판정 없음)
        ['Pu', 'design-P', 'force', 'num', _C('required', null, 'load')],
        ['Vu', 'design-V', 'force', 'num', _C('required', null, 'load')],
        ['Mux', 'design-Mx', 'moment', 'num', _C('required', null, 'load')],
        ['designMxPos', 'design-Mx-pos', 'moment', 'num', _C('required', null, 'load')],
        ['Muy', 'design-My', 'moment', 'num', _C('required', null, 'load')],
        ['designZeroDemandStated', 'chk-design-zero-demand', null, 'chk', _C('required', false, 'load')],
        ['MayStrength', 'design-May-strength', 'moment', 'num', _C('required', 0, 'load')],
        ['chkBetaDist', 'chk-beta-dist', null, 'chk', _C('options', true, 'design')],
        ['distM1M2', 'design-dist-M1M2', null, 'num', _C('options', 0, 'design')],
        ['distLm', 'design-dist-Lm', 'length', 'num', _C('options', 0, 'design')],
        ['chkRFactor', 'chk-r-factor', null, 'chk', _C('options', false, 'design')],
        // §I6.2.1 R: 선택지의 정체는 optSpan. 연속 0.70 은 값이 '0.70:continuous'(K2-2, D-1 — 전에는 단순과 같은 '0.70' 이라 다시 열면 단순이 됐다).
        // 화면 본문은 parseFloat 로 0.7 을 보낸다. 옛 파일의 '0.70' 은 단순으로 읽힌다(지금까지와 같다).
        ['rValue', 'select-r-value', null, 'sel', _C('options', '0', 'design', {
            opts: ['0', '0.70', '0.65', '0.50', '0.40', '0.60', '0.70:continuous'],
            optSpan: [null, 'simple', 'simple', 'simple', 'simple', 'continuous', 'continuous'] })],
        ['chkColdWork', 'chk-cold-work', null, 'chk', _C('options', true, 'design')],
        ['chkInelasticReserve', 'chk-inelastic-reserve', null, 'chk', _C('options', false, 'design')],
        // 웹 크리플링
        ['wcN', 'design-wc-N', 'length', 'num', _C('webCrippling', 89, 'design')],
        ['wcR', 'design-wc-R', 'length', 'num', _C('webCrippling', 4.8, 'design')],
        ['wcP', 'design-wc-P', 'force', 'num', _C('webCrippling', null, 'design')],
        ['wcSupport', 'design-wc-support', null, 'sel', _C('webCrippling', 'EOF', 'design', { opts: ['EOF', 'IOF', 'ETF', 'ITF'] })],
        ['wcFastened', 'design-wc-fastened', null, 'sel', _C('webCrippling', 'fastened', 'design', { opts: ['fastened', 'unfastened'] })],
        ['wcWebConfig', 'design-wc-web-config', null, 'sel', _C('webCrippling', 'single', 'design', { opts: ['single', 'nested_z', 'multi_web'] })],
        ['wcFamily', 'design-wc-family', null, 'sel', _C('webCrippling', 'auto', 'design', { opts: ['auto', 'built_up_i', 'C', 'Z', 'hat', 'multi_web'] })],
        ['wcFlangeCondition', 'design-wc-flange-condition', null, 'sel', _C('webCrippling', 'stiffened', 'design', { opts: ['stiffened', 'unstiffened'] })],
        ['wcLo', 'design-wc-Lo', 'length', 'num', _C('webCrippling', 0, 'design')],
        ['wcEdgeDistance', 'design-wc-edge-distance', 'length', 'num', _C('webCrippling', 0, 'design')],
        ['wcNWebs', 'design-wc-nwebs', null, 'num', _C('webCrippling', 1, 'design')],
        ['wcFastenerSpacing', 'design-wc-fastener-spacing', 'length', 'num', _C('webCrippling', 0, 'design')],
        // 템플릿 (모델 — 「생성」 때 모델로, 모델이 오면 칸이 따라온다)
        ['templateType', 'select-template', null, 'sel', _M('template', 'design')],
        ['tplH', 'tpl-H', 'length', 'num', _M('template', 'design')],
        ['tplB', 'tpl-B', 'length', 'num', _M('template', 'design')],
        ['tplD', 'tpl-D', 'length', 'num', _M('template', 'design')],
        ['tplT', 'tpl-t', 'thickness', 'num', _M('template', 'design')],
        ['tplR', 'tpl-r', 'radius', 'num', _M('template', 'design')],
        ['tplQlip', 'tpl-qlip', null, 'num', _M('template', 'design')],
        // 해석 탭 (모델 — 「해석 실행」 때 모델로)
        ['analysisBC', 'select-bc', null, 'sel', _M('analysis', 'analysis-at-run')],
        ['analysisLoadCase', 'select-load-case', null, 'sel', _M('analysis', 'analysis-at-run')],
        ['analysisNeigs', 'input-neigs', null, 'num', _M('analysis', 'analysis-at-run')],
        ['analysisLenMin', 'input-len-min', 'length', 'num', _M('analysis', 'analysis-at-run')],
        ['analysisLenMax', 'input-len-max', 'length', 'num', _M('analysis', 'analysis-at-run')],
        ['analysisLenN', 'input-len-n', null, 'num', _M('analysis', 'analysis-at-run')],
        ['analysisLoadPUs', 'input-load-P', 'force', 'num', _M('analysis', 'analysis-at-run')],
        ['analysisLoadMxxUs', 'input-load-Mxx', 'moment', 'num', _M('analysis', 'analysis-at-run')],
        ['analysisLoadMzzUs', 'input-load-Mzz', 'moment', 'num', _M('analysis', 'analysis-at-run')],
        ['chkCfsmEnable', 'chk-cfsm-enable', null, 'chk', _V(true)],
        ['chkCfsmG', 'chk-cfsm-G', null, 'chk', _V(true)],
        ['chkCfsmD', 'chk-cfsm-D', null, 'chk', _V(true)],
        ['chkCfsmL', 'chk-cfsm-L', null, 'chk', _V(true)],
        ['chkCfsmO', 'chk-cfsm-O', null, 'chk', _V(true)],
        ['vibRho', 'vib-rho', 'density', 'num', _C('vibration', null, 'none')],
        ['vibLengths', 'vib-lengths', 'length', 'list', _C('vibration', null, 'none')],
        // 접합부 탭
        ['connFastenerType', 'conn-fastener-type', null, 'sel', _C('lap', 'screw', 'connection', { opts: ['screw', 'bolt'] })],
        ['connSingleType', 'conn-single-type', null, 'sel', _C('connection', 'screw', 'connection',
            { opts: ['screw', 'bolt', 'paf', 'fillet_weld', 'arc_spot', 'arc_seam', 'groove'] })],
        ['connGrooveType', 'conn-groove-type', null, 'sel', _C('connection', 'complete', 'connection', { opts: ['complete', 'partial'] })],
        ['connLapLeft', 'conn-lap-left', 'length', 'num', _C('lap', 305, 'connection')],
        ['connLapRight', 'conn-lap-right', 'length', 'num', _C('lap', 305, 'connection')],
        // V8-01: 랩이 걸친 지점(1 부터 — 「지점 3」). 퍼린 결과의 그 지점 랩 구간에서 단면 강도(Se · Vn)를 가져온다. 비면 짓지 않는다
        ['connLapSupport', 'conn-lap-support', null, 'num', _C('lap', null, 'connection')],
        // V9a-02 · 계약 §6.3(엔진 5df4464): 주지 않은 소요는 0 이 아니다 — 처음 값은 비움(요청에 넣지 않는다 → 그 소요를 쓰는 검토는 판정 없음).
        // 0 은 사람 · AI 가 밝혔을 때만(connZeroDemandStated → zero_demand_stated)
        ['connMu', 'conn-Mu', 'moment', 'num', _C('lap', null, 'connection')],
        ['connVu', 'conn-Vu', 'force', 'num', _C('lap', null, 'connection')],
        ['connZeroDemandStated', 'chk-conn-zero-demand', null, 'chk', _C('lap', false, 'connection')],
        ['connFastenerDia', 'conn-fastener-dia', 'length', 'num', _C('lap', 4.8, 'connection')],
        ['connNRows', 'conn-n-rows', null, 'num', _C('lap', 2, 'connection')],
        ['connEdgeDist', 'conn-edge-dist', 'length', 'num', _C('lap', null, 'connection')],
        ['connLapPnvs', 'conn-lap-Pnvs', 'force', 'num', _C('lap', null, 'connection')],
        ['connT1', 'conn-t1', 'thickness', 'num', _C('connection', 1.5, 'connection')],
        ['connT2', 'conn-t2', 'thickness', 'num', _C('connection', 1.5, 'connection')],
        ['connD', 'conn-d', 'length', 'num', _C('connection', 4.8, 'connection')],
        ['connN', 'conn-n', null, 'num', _C('connection', 4, 'connection')],
        // 접합 Fy · Fu: ① 재료가 바뀔 때 복사되고 그 뒤로는 따로(사람이 고칠 수 있다) — 상태에서는 따로 둔다(followsWhileMirror)
        ['connFy', 'conn-Fy', 'stress', 'num', _C('connection', 295, 'connection', { src: 'steel', follows: 'fy' })],
        ['connFu', 'conn-Fu', 'stress', 'num', _C('connection', 400, 'connection', { src: 'steel', follows: 'fu' })],
        ['connWeldL', 'conn-weld-L', 'length', 'num', _C('connection', 50, 'connection')],
        ['connWeldSize', 'conn-weld-size', 'length', 'num', _C('connection', 3, 'connection')],
        ['connFub', 'conn-Fub', 'stress', 'num', _C('connection', null, 'connection')],
        ['connFuf', 'conn-Fuf', 'stress', 'num', _C('connection', null, 'connection')],
        ['connPnvs', 'conn-Pnvs', 'force', 'num', _C('connection', null, 'connection')],
        ['connDw', 'conn-dw', 'length', 'num', _C('connection', null, 'connection')],
        ['connPu', 'conn-Pu', 'force', 'num', _C('connection', null, 'connection')],
        ['connTu', 'conn-Tu', 'force', 'num', _C('connection', null, 'connection')],
        ['connE', 'conn-e', 'length', 'num', _C('connection', null, 'connection')],
        ['connS', 'conn-s', 'length', 'num', _C('connection', null, 'connection')],
        ['connMemberCase', 'conn-member-case', null, 'sel', _C('connection', '', 'connection', {
            src: 'page', opts: ['', 'not_tension_member', 'flat_sheet', 'flat_sheet_staggered', 'angle_bolted', 'angle_welded',
                'channel_bolted', 'channel_welded', 'all_elements', 'transverse_weld'] })],
        ['connWidth', 'conn-width', 'length', 'num', _C('connection', null, 'connection')],
        ['connJ63NotApplicable', 'conn-j63-na', null, 'chk', _C('connection', false, 'connection')],
    ];

    /**
     * V4-28: 바꿔도 설계 · 하중 결과를 지우지 않는 칸(그 결과를 만드는 데 쓰이지 않는다). [id, 까닭]
     * 이 밖의 칸(설계 · 하중 · 재료 · 단면 입력)은 바뀌면 결과를 지운다.
     */
    const VIEW_ONLY_CONTROLS = [
        ['select-length', '모드 형상 보기: 반파장 선택'],
        ['select-mode', '모드 형상 보기: 모드 번호 선택'],
        ['vib-rho', '진동 해석 입력 — 진동 결과에만 쓰임(설계 · 하중과 무관)'],
        ['vib-lengths', '진동 해석 입력 — 진동 결과에만 쓰임'],
        // 좌굴 해석 조건: 「해석 실행」 때 모델에 들어가고, 그때 호스트가 해석 · 설계 결과를 무효화한다 —
        // 칸을 바꾸는 순간에는 지금 결과가 아직 그 조건으로 만든 것이다.
        ['select-load-case', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-load-P', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-load-Mxx', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-load-Mzz', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['select-bc', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-len-min', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-len-max', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-len-n', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-neigs', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['chk-cfsm-enable', '분류 표시 설정'],
        ['chk-cfsm-G', '분류 표시 설정'],
        ['chk-cfsm-D', '분류 표시 설정'],
        ['chk-cfsm-L', '분류 표시 설정'],
        ['chk-cfsm-O', '분류 표시 설정'],
    ];
    const _VIEW_ONLY_IDS = new Set(VIEW_ONLY_CONTROLS.map(x => x[0]));
    /** 이 칸의 변경이 결과를 지워야 하나(V4-28). */
    function invalidatesResults(id) { return !!id && !_VIEW_ONLY_IDS.has(String(id)); }

    /** 단위 전환용: { id: unitType } (단위 있는 칸만). */
    const UNIT_FIELDS = (function () {
        const out = {};
        FIELDS.forEach(([, id, unit]) => { if (unit) { out[id] = unit; } });
        return out;
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // K2-1 — 상태 표의 순수 함수(아직 화면 · 호스트 어디서도 부르지 않는다). 설계 §2 · §4.2.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 화면의 단위 계수(US × 계수 = SI) — webview/js/app.js 의 UNIT 표와 **같은 식**이다(test/webview/k2_case_state.js 가
     * app.js 의 그 줄을 읽어 바이트까지 대조한다). 처음 값의 US 값을 화면과 같은 double 로 만들려고 둔다.
     */
    const _KIP_KN = 4.4482216152605, _IN_MM = 25.4, _IN_M = 0.0254, _FT_M = 0.3048;
    const UNIT_FACTORS = {
        length: 25.4, length_ft: 0.3048, area: _IN_MM * _IN_MM, inertia: Math.pow(_IN_MM, 4), modulus: Math.pow(_IN_MM, 3),
        stress: _KIP_KN * 1000 / (_IN_MM * _IN_MM), force: _KIP_KN, moment: _KIP_KN * _IN_M, moment_ft: _KIP_KN * _FT_M,
        pressure: _KIP_KN / 1000 / (_FT_M * _FT_M), linload: _KIP_KN / 1000 / _FT_M, thickness: 25.4, radius: 25.4,
        rotStiff: _KIP_KN, latStiff: _KIP_KN / (_IN_M * _IN_M), density: _KIP_KN * 1000 / Math.pow(_IN_M, 4),
    };
    /** 화면의 fromDisplay 와 같은 식: SI 표시값 → US */
    function siToUs(v, unit) { return unit && UNIT_FACTORS[unit] ? v / UNIT_FACTORS[unit] : v; }

    const _BY_KEY = new Map(FIELDS.map((r) => [r[0], r]));
    const _OWNERS = ['case', 'mirror', 'model', 'view'];
    /** 소유별 키 */
    const KEYS = {};
    _OWNERS.forEach((o) => { KEYS[o] = FIELDS.filter((r) => r[4].owner === o).map((r) => r[0]); });

    /** 키의 표 한 줄 { key, id, unit, kind, ...meta } (없으면 null) */
    function fieldMeta(key) {
        const r = _BY_KEY.get(key);
        return r ? Object.assign({ key: r[0], id: r[1], unit: r[2], kind: r[3] }, r[4]) : null;
    }

    /**
     * 키의 처음 값(US 내부값) — 지금 화면이 처음 열렸을 때 collectDesignInputs 가 읽는 값과 같다(SI 화면의 칸 글을
     * 화면과 같은 식으로 바꾼 것). model 키는 null(모델에서 온다), mirror 키는 그 주인의 값.
     */
    function defaultValue(key) {
        const m = fieldMeta(key);
        if (!m) { return undefined; }
        if (m.owner === 'mirror') { return defaultValue(m.mirrorOf); }
        if (m.def == null) { return null; }
        if (m.kind === 'num') { return siToUs(m.def, m.unit); }
        if (m.kind === 'list') { return m.def.map((v) => siToUs(v, m.unit)); }
        return m.def;
    }

    /** 경간 수 — 화면 getSpanCount 와 같은 규칙 */
    function spanCount(spanType, nSpans) {
        if (spanType === 'simple' || spanType === 'cantilever') { return 1; }
        if (spanType === 'cont-n') { return Number(nSpans); }
        const m = /cont-(\d+)/.exec(String(spanType || ''));
        return m ? parseInt(m[1], 10) : 1;
    }

    /**
     * 경간 표의 처음 값 — 화면 buildSpanTable 과 같은 규칙(경간 5 m, 지점 P(캔틸레버 F · N), 랩 0, 단순 · 캔틸레버는 랩 칸 없음).
     * 값은 collectDesignInputs 의 모양(ft, 없는 칸은 null). 화면은 경간 칸을 그때의 단위로 소수 둘째 자리까지 적으므로
     * (toFixed(2)) 처음 경간은 SI 화면에서 5.00 m, US 화면에서 16.40 ft 다 — unitSystem 이 그 차이를 그대로 만든다.
     */
    function defaultSpanTable(spanType, nSpans, unitSystem) {
        const n = spanCount(spanType, nSpans);
        const isSimple = spanType === 'simple' || spanType === 'cantilever';
        // 화면: toDisplay(5.0 / 0.3048, 'length_ft').toFixed(2) — SI '5.00' → 5 / 0.3048 ft, US '16.40' → 16.4 ft
        const span = unitSystem === 'US' ? Number((5.0 / UNIT_FACTORS.length_ft).toFixed(2)) : siToUs(Number((5.0).toFixed(2)), 'length_ft');
        const spans = [], supports = [], lapsPerSupport = [];
        for (let i = 0; i <= n; i++) {
            if (i < n) { spans.push(span); }
            supports.push(spanType === 'cantilever' ? (i === 0 ? 'F' : 'N') : 'P');
            lapsPerSupport.push({ left: (i > 0 && !isSimple) ? 0 : null, right: (i < n && !isSimple) ? 0 : null });
        }
        return { spans, supports, lapsPerSupport };
    }

    /**
     * 처음 입력 한 벌(1.3 의 designInputs 모양, US) — case · mirror · view 키는 표의 처음 값, model 키는 null.
     * 화면의 `_initialInputs`(처음 열었을 때 collectDesignInputs) 와 model 키 · unitSystem 을 빼고 같다.
     */
    function defaultInputs() {
        const out = { unitSystem: 'SI', analysisMethod: 'DSM' };
        for (const [key] of FIELDS) { out[key] = defaultValue(key); }
        Object.assign(out, defaultSpanTable(out.spanType, out.nSpans));
        return out;
    }

    /** 화면의 지금 입력(= collectDesignInputs — K2 의 이름). */
    function snapshot(deps) { return collectDesignInputs(deps); }

    const _SPAN_KEYS = ['spans', 'supports', 'lapsPerSupport'];
    /**
     * 두 입력 묶음의 다른 키 → { key: 새 값 }. 표의 키 · 경간 표 셋 · unitSystem 을 본다(analysisMethod 는 늘 'DSM').
     * 값은 JSON 으로 비교한다(배열 · 랩 객체 포함, NaN 은 null 로 본다 — 화면의 목록 칸 규칙).
     */
    function diff(last, now) {
        const a = last || {}, b = now || {};
        const out = {};
        const keys = FIELDS.map((r) => r[0]).concat(_SPAN_KEYS, ['unitSystem']);
        for (const k of keys) {
            if (!(k in b)) { continue; }
            if (JSON.stringify(a[k] === undefined ? null : a[k]) !== JSON.stringify(b[k] === undefined ? null : b[k])) { out[k] = b[k]; }
        }
        return out;
    }

    /**
     * 선택 칸에 들어온 글 → 선택지 값. 정확히 같으면 그것, 아니면 수로 같은 첫 선택지(결함 D-2: 화면이 '0.7' 을 넣어
     * '0.70' 이 골리지 않는다). 없으면 null.
     */
    function matchOption(key, value) {
        const m = fieldMeta(key);
        if (!m || !m.opts) { return null; }
        const s = String(value);
        if (m.opts.includes(s)) { return s; }
        const n = Number(s);
        if (s.trim() !== '' && isFinite(n)) { const hit = m.opts.find((o) => o.trim() !== '' && Number(o) === n); if (hit !== undefined) { return hit; } }
        return null;
    }

    /**
     * 값 하나의 검사(키 · 종류 · 선택지). 반환 null = 괜찮음, 아니면 까닭(사람이 읽는 글 — 화면 · MCP 가 그대로 쓴다).
     * opts.owners: 받을 소유(기본 ['case'] — model · view 키는 이 길로 쓰지 않는다).
     */
    function validateValue(key, value, opts) {
        const owners = (opts && opts.owners) || ['case'];
        const m = fieldMeta(key);
        if (!m) { return `모르는 입력 키 '${key}'`; }
        if (!owners.includes(m.owner)) { return `'${key}' 은(는) ${m.owner} 소유라 이 길로 쓸 수 없다`; }
        if (value === null) { return (m.kind === 'chk' || m.kind === 'sel') ? `'${key}' 는 비울 수 없다(${m.kind === 'chk' ? 'true/false' : '선택지'})` : null; }
        if (m.kind === 'num') { return (typeof value === 'number' && isFinite(value)) ? null : `'${key}' 는 수여야 한다`; }
        if (m.kind === 'chk') { return typeof value === 'boolean' ? null : `'${key}' 는 true/false 여야 한다`; }
        if (m.kind === 'sel' && !m.opts) { return typeof value === 'string' ? null : `'${key}' 는 글이어야 한다`; }
        if (m.kind === 'sel') { return (typeof value === 'string' && m.opts.includes(value)) ? null : `'${key}' 의 선택지가 아니다: ${JSON.stringify(value)} (가능: ${m.opts.map((o) => JSON.stringify(o)).join(', ')})`; }
        if (m.kind === 'list') { return (Array.isArray(value) && value.every((v) => typeof v === 'number' && isFinite(v))) ? null : `'${key}' 는 수의 목록이어야 한다`; }
        return `'${key}' 의 종류 ${m.kind} 를 검사할 수 없다`;
    }

    /** 경간 표 검사(경간 수 = spanType · nSpans 로 정해지는 수, 지점 P · R · F · N, 랩 { left, right }). 반환: 까닭 목록 */
    function validateSpanTable(t, spanType, nSpans) {
        const errs = [];
        const n = spanCount(spanType, nSpans);
        if (!t || !Array.isArray(t.spans) || t.spans.length !== n) { errs.push(`경간 길이는 ${n} 개여야 한다`); }
        else if (!t.spans.every((v) => v === null || (typeof v === 'number' && isFinite(v)))) { errs.push('경간 길이는 수(ft) 또는 빈 칸'); }
        if (!t || !Array.isArray(t.supports) || t.supports.length !== n + 1) { errs.push(`지점은 ${n + 1} 개여야 한다`); }
        else if (!t.supports.every((s) => ['P', 'R', 'F', 'N'].includes(s))) { errs.push('지점은 P · R · F · N'); }
        if (!t || !Array.isArray(t.lapsPerSupport) || t.lapsPerSupport.length !== n + 1) { errs.push(`지점별 랩은 ${n + 1} 개여야 한다`); }
        else if (!t.lapsPerSupport.every((l) => l && ['left', 'right'].every((s) => l[s] === null || (typeof l[s] === 'number' && isFinite(l[s]))))) {
            errs.push('지점별 랩은 { left, right } (ft 또는 null)');
        }
        return errs;
    }

    /** 바뀐 키들이 낡게 하는 결과의 가장 넓은 범위 — 'none' < 'connection' < 'design' < 'load' (+ 'analysis-at-run' 은 따로) */
    function invalidationScope(keys) {
        const rank = { none: 0, 'analysis-at-run': 0, connection: 1, design: 2, load: 3 };
        let best = 'none';
        let atRun = false;
        for (const k of keys || []) {
            const m = fieldMeta(k);
            let inv = m ? m.inv : (_SPAN_KEYS.includes(k) ? 'load' : 'none');
            if (inv === 'analysis-at-run') { atRun = true; inv = 'none'; }
            if (rank[inv] > rank[best]) { best = inv; }
        }
        return { scope: best, analysisAtRun: atRun };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // D-5(K2-7): 칸에 적힌 글은 표시값(12 자리)일 뿐이다. 프로그램이 정확한 US 값으로 칸을 채울 때 그 값을 칸에 함께 둔다
    // (data-case-exact · data-case-shown). 칸의 글이 그때 적은 글 그대로면 읽을 때 그 정확한 값을 쓴다 — 표시의 반올림이 값으로 새지 않는다.
    // 사람이 고치면 글이 달라지므로 그때부터는 글을 읽는다.
    // ─────────────────────────────────────────────────────────────────────────
    /** 칸에 글을 적고(그 글이 나타내는 정확한 US 값과 함께) */
    function setShown(el, text, usValue) {
        if (!el) { return; }
        el.value = text;
        if (!el.dataset) { return; }
        if (typeof usValue === 'number' && isFinite(usValue) && String(text) !== '') {
            el.dataset.caseExact = String(usValue);
            el.dataset.caseShown = String(el.value);
        } else {
            delete el.dataset.caseExact;
            delete el.dataset.caseShown;
        }
    }
    /** 칸의 정확한 US 값(프로그램이 적은 글 그대로일 때만) — 아니면 undefined */
    function exactOf(el) {
        if (!el || !el.dataset || el.dataset.caseShown === undefined) { return undefined; }
        if (String(el.value) !== el.dataset.caseShown) { return undefined; }
        const v = Number(el.dataset.caseExact);
        return isFinite(v) ? v : undefined;
    }
    /** 칸의 US 값: 정확한 값이 있으면 그것, 아니면 글을 표시 단위에서 바꾼 것(빈 칸 · 수 아님 → null) */
    function readUs(el, unit, fromDisplay) {
        const ex = unit ? exactOf(el) : undefined;
        if (ex !== undefined) { return ex; }
        const raw = String(el && el.value != null ? el.value : '').trim();
        if (raw === '') { return null; }
        const v = parseFloat(raw);
        return !isFinite(v) ? null : (unit ? fromDisplay(v, unit) : v);
    }
    /** 결정 1: AI 가 주지 않은 선택 · 체크(상태 null) — 칸에 표지를 달고, 읽으면 null */
    function _markUnset(el, on) {
        if (!el || !el.dataset) { return; }
        if (on) {
            el.dataset.caseUnset = '1';
            if (!el.dataset.caseTitle) { el.dataset.caseTitle = el.title || ''; }
            el.title = 'AI: 주지 않음 — 엔진이 정한다(설계 도구가 받지 않은 값). 고르면 그 값으로';
            if (el.classList) { el.classList.add('case-unset'); }
        } else if (el.dataset.caseUnset) {
            delete el.dataset.caseUnset;
            el.title = el.dataset.caseTitle || '';
            delete el.dataset.caseTitle;
            if (el.classList) { el.classList.remove('case-unset'); }
        }
    }

    function _readRaw(document, id) {
        const el = document.getElementById(id);
        if (!el) { return undefined; }
        return el;
    }

    function collectDesignInputs(deps) {
        const { document, fromDisplay, getUnitSystem } = deps;
        const data = {};
        if (typeof getUnitSystem === 'function') {
            data.unitSystem = getUnitSystem();
        }
        data.analysisMethod = 'DSM'; // 해석법은 DSM 고정 (구 select-analysis-method 드롭다운 제거됨)
        for (const [key, id, unit, kind] of FIELDS) {
            const el = _readRaw(document, id);
            if (el === undefined) { continue; }
            if ((kind === 'chk' || kind === 'sel') && el.dataset && el.dataset.caseUnset === '1') { data[key] = null; continue; }
            if (kind === 'chk') { data[key] = !!el.checked; continue; }
            if (kind === 'sel') { data[key] = el.value; continue; }
            if (kind === 'num') { data[key] = readUs(el, unit, fromDisplay); continue; }
            const raw = String(el.value == null ? '' : el.value).trim();
            if (kind === 'list') {
                data[key] = raw === '' ? null
                    : raw.split(/[,;\s]+/).filter(Boolean).map(Number)
                        .map(v => (isFinite(v) ? (unit ? fromDisplay(v, unit) : v) : NaN));
                continue;
            }
            if (raw === '') { data[key] = null; continue; }
            const v = parseFloat(raw);
            data[key] = !isFinite(v) ? null : (unit ? fromDisplay(v, unit) : v);
        }

        // 경간 · 지점 · 랩 표 (빈 칸은 null)
        const spanLens = [];
        const sups = [];
        const laps = [];
        const num = (el, unit) => readUs(el, unit, fromDisplay);
        document.querySelectorAll('.span-tbl-len').forEach(el => { spanLens.push(num(el, 'length_ft')); });
        document.querySelectorAll('.span-tbl-sup').forEach(el => { sups.push(el.value); });
        for (let i = 0; i < sups.length; i++) {
            const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
            const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
            laps.push({ left: lEl ? num(lEl, 'length_ft') : null, right: rEl ? num(rEl, 'length_ft') : null });
        }
        data.spans = spanLens;
        data.supports = sups;
        data.lapsPerSupport = laps;
        return data;
    }

    function _applyValues(deps, data) {
        const { document, toDisplay } = deps;
        const setValue = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; } };
        for (const [key, id, unit, kind] of FIELDS) {
            if (!(key in data)) { continue; }
            const el = document.getElementById(id);
            if (!el) { continue; }
            const v = data[key];
            if (kind === 'chk' || kind === 'sel') { _markUnset(el, v === null); }
            if (kind === 'chk') { if (v != null) { el.checked = !!v; } continue; }
            if (kind === 'sel') { if (v != null && v !== '') { el.value = v; } continue; }
            if (kind === 'list') {
                el.value = Array.isArray(v) && v.length > 0
                    ? v.map(x => String(Number((unit ? toDisplay(x, unit) : x).toPrecision(6)))).join(', ')
                    : '';
                continue;
            }
            if (v == null || !isFinite(v)) { setShown(el, '', null); continue; }
            // 단위 전환(refreshUnits)과 같은 12 자리 — 부동소수 꼬리(118.11023622047244)를 보이지 않게. 정확한 값은 칸에 함께(D-5).
            if (unit) { setShown(el, String(Number(Number(toDisplay(v, unit)).toPrecision(12))), v); } else { setShown(el, v, null); }
        }
        // 옛 파일(v1.0–1.2): custom 하중은 표시값으로만 있었다
        if (!('analysisLoadPUs' in data) && data.analysisLoadP != null) setValue('input-load-P', data.analysisLoadP);
        if (!('analysisLoadMxxUs' in data) && data.analysisLoadMxx != null) setValue('input-load-Mxx', data.analysisLoadMxx);
        if (!('analysisLoadMzzUs' in data) && data.analysisLoadMzz != null) setValue('input-load-Mzz', data.analysisLoadMzz);
    }

    function _fillSpans(deps, data) {
        const { document, toDisplay } = deps;
        const show = (el, v) => {
            if (!el) { return; }
            if (v == null || !isFinite(v)) { setShown(el, '', null); return; }
            setShown(el, toDisplay(v, 'length_ft'), v);   // 글은 전과 같다(반올림 없이) — 정확한 값만 더한다
        };
        if (data.spans) {
            document.querySelectorAll('.span-tbl-len').forEach((el, i) => {
                if (i < data.spans.length) show(el, data.spans[i]);
            });
        }
        if (data.supports) {
            document.querySelectorAll('.span-tbl-sup').forEach((el, i) => {
                if (data.supports[i]) el.value = data.supports[i];
            });
        }
        if (data.lapsPerSupport) {
            data.lapsPerSupport.forEach((lap, i) => {
                const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
                const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
                if (lap && 'left' in lap) show(lEl, lap.left);
                if (lap && 'right' in lap) show(rEl, lap.right);
            });
        }
    }

    /**
     * 복원. deps.initialInputs(화면을 처음 열었을 때 collectDesignInputs 한 값)가 있으면 먼저 모든 칸을 그 값으로
     * 되돌린 뒤 파일 값을 얹는다 — 파일에 없는 칸이 이전 프로젝트 값을 지니지 않게(V4-10).
     * 빈 칸(null)은 빈 칸으로 돌아온다(V4-07).
     */
    function restoreDesignInputs(deps, data) {
        if (!data) {
            return;
        }
        const { document, toDisplay, buildSpanTable, setTimeoutFn, updateAnalysisFyDisplay, setUnitSystem } = deps;

        // 단위 시스템 복원 (다른 값 복원 전에 먼저 설정)
        if (data.unitSystem && typeof setUnitSystem === 'function') {
            setUnitSystem(data.unitSystem);
        }
        if (deps.initialInputs && typeof deps.initialInputs === 'object') {
            const init = { ...deps.initialInputs };
            delete init.unitSystem;
            _applyValues(deps, init);
        }
        _applyValues(deps, data);

        // 강종 Fy · Fu 단일 소스: 설계 Fy 가 있으면 전처리 · 소성 칸도 같은 값(옛 파일 호환)
        // D-5: 12 자리 글 + 정확한 값(_applyValues 와 같은 규칙) — 전: 반올림 없는 글을 덮어 정확한 값을 지웠다
        const shown = (us) => String(Number(Number(toDisplay(us, 'stress')).toPrecision(12)));
        const setStress = (id, us) => { const el = document.getElementById(id); if (el) { setShown(el, shown(us), us); } };
        if (data.fu != null && !('fuPre' in data)) {
            setStress('input-fu', data.fu);
        }
        const fyUs = data.fy != null ? data.fy : data.fyLoad != null ? data.fyLoad : null;
        const restoredFy = fyUs != null ? shown(fyUs) : null;
        if (restoredFy != null) {
            setStress('input-fy', fyUs);
            setStress('plastic-fy', fyUs);
            setStress('design-fy', fyUs);
            if (typeof updateAnalysisFyDisplay === 'function') {
                updateAnalysisFyDisplay(restoredFy);
            }
        } else if (typeof updateAnalysisFyDisplay === 'function') {
            // 처음 값으로 되돌린 Fy 를 해석 탭 표시에도(입력 기록이 없는 파일 — V4-10)
            const fyEl = document.getElementById('input-fy');
            if (fyEl) { updateAnalysisFyDisplay(fyEl.value); }
        }

        if (typeof buildSpanTable === 'function') {
            // buildSpanTable 은 동기 함수다 — 표가 이미 만들어졌으므로 곧바로 채운다(전: 100 ms 타이머).
            buildSpanTable();
            _fillSpans(deps, data);
        } else {
            (typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout)(() => _fillSpans(deps, data), 0);
        }

        // 값만 바꾸면 화면의 연동(필드 표시, PLF, β, custom 하중 칸, 접합 유형 칸)이 갱신되지 않는다 — 호출자가 돌린다.
        if (typeof deps.afterRestore === 'function') {
            deps.afterRestore();
        }
    }

    // Lap 접합부 지배값 선택 (순수함수 — app.js _autoFillLapInputs와 node 테스트 공용).
    // locations[].Mu는 kip-ft. 'Lap end' 위치와 정모멘트(Mu>0)를 제외하고
    // 지점 부모멘트(Mu<0) 중 최대 |Mu|를 선택한다(§4 이슈2A 회귀 고정).
    // Vu는 위치 무관 최대 |Vu|.
    // 반환: { negMuFt: number|null(부모멘트 원값, kip-ft), maxVu: number,
    //         negMuName: string|null }
    function selectLapGoverningMoment(locations) {
        let maxNegMu = 0;
        let maxVu = 0;
        let negMuName = null;
        let negMuSupport = null;
        (locations || []).forEach(function (loc) {
            if (!loc) return;
            if ((loc.name || '').indexOf('Lap end') === 0) return;
            const atSupport = Number.isInteger(loc.support) && loc.support > 0;
            const bigger = loc.Mu != null && loc.Mu < 0 && Math.abs(loc.Mu) > Math.abs(maxNegMu);
            // V8-01: 같은 크기(경간의 「-M」 과 그 지점)면 지점의 위치를 — 랩 탭이 그 지점의 랩 길이 · 랩 구간 강도를 쓴다
            const tieAtSupport = loc.Mu != null && loc.Mu < 0 && maxNegMu !== 0 && negMuSupport === null && atSupport
                && Math.abs(Math.abs(loc.Mu) - Math.abs(maxNegMu)) <= 1e-9 * Math.abs(maxNegMu);
            if (bigger || tieAtSupport) {
                maxNegMu = loc.Mu;
                negMuName = loc.name || null;
                negMuSupport = atSupport ? loc.support : null;
            }
            if (loc.Vu != null && Math.abs(loc.Vu) > maxVu) maxVu = Math.abs(loc.Vu);
        });
        return {
            negMuFt: maxNegMu !== 0 ? maxNegMu : null,
            maxVu: maxVu,
            negMuName: negMuName,
            negMuSupport: negMuSupport,
        };
    }

    return {
        FIELDS,
        UNIT_FIELDS,
        VIEW_ONLY_CONTROLS,
        invalidatesResults,
        collectDesignInputs,
        restoreDesignInputs,
        selectLapGoverningMoment,
        // K2-7(D-5): 정확한 값 · 결정 1: 주지 않음
        setShown,
        exactOf,
        readUs,
        markUnset: _markUnset,
        // K2-1
        UNIT_FACTORS,
        KEYS,
        fieldMeta,
        defaultValue,
        defaultInputs,
        spanCount,
        defaultSpanTable,
        snapshot,
        diff,
        matchOption,
        validateValue,
        validateSpanTable,
        invalidationScope,
        siToUs,
    };
});
