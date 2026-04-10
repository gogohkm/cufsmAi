const path = require('path');
const designState = require(path.join(__dirname, '..', '..', 'webview', 'js', 'designState.js'));

const UNIT = {
    length: { factor: 25.4 },
    length_ft: { factor: 0.3048 },
    stress: { factor: 6.89476 },
    force: { factor: 4.44822 },
    moment: { factor: 0.11298 },
    pressure: { factor: 0.04788 },
    thickness: { factor: 25.4 },
    radius: { factor: 25.4 },
    rotStiff: { factor: 4.44822 },
};

function toDisplay(usValue, unitType) {
    return usValue * UNIT[unitType].factor;
}

function fromDisplay(displayValue, unitType) {
    return displayValue / UNIT[unitType].factor;
}

function approx(actual, expected, tol = 1e-9, label = 'value') {
    if (Math.abs(actual - expected) > tol) {
        throw new Error(`${label}: expected ${expected}, got ${actual}`);
    }
}

class FakeElement {
    constructor(value = '') {
        this.value = value;
        this.style = {};
    }
}

class FakeDocument {
    constructor() {
        this.byId = new Map();
        this.spanLens = [];
        this.supports = [];
        this.lapL = [];
        this.lapR = [];
    }

    ensure(id, value = '') {
        if (!this.byId.has(id)) {
            this.byId.set(id, new FakeElement(value));
        }
        const el = this.byId.get(id);
        if (value !== undefined) {
            el.value = value;
        }
        return el;
    }

    getElementById(id) {
        return this.byId.get(id) || null;
    }

    querySelectorAll(selector) {
        if (selector === '.span-tbl-len') return this.spanLens;
        if (selector === '.span-tbl-sup') return this.supports;
        if (selector === '.span-tbl-lapl') return this.lapL;
        if (selector === '.span-tbl-lapr') return this.lapR;
        return [];
    }

    querySelector(selector) {
        const match = selector.match(/^\.([a-z-]+)\[data-idx="(\d+)"\]$/);
        if (!match) return null;
        const idx = Number(match[2]);
        switch (match[1]) {
            case 'span-tbl-lapl':
                return this.lapL[idx] || null;
            case 'span-tbl-lapr':
                return this.lapR[idx] || null;
            default:
                return null;
        }
    }
}

function createBaseDocument() {
    const doc = new FakeDocument();
    const ids = {
        'select-steel-grade': 'SGC400',
        'design-fy': '345',
        'design-fu': '490',
        'input-fu': '',
        'select-design-method': 'LRFD',
        'select-analysis-method': 'DSM',
        'select-member-type': 'flexure',
        'select-span-type': 'cont-n',
        'config-n-spans': '3',
        'config-spacing': '1.5',
        'load-D-psf': '0.95',
        'load-Lr-psf': '1.80',
        'load-S-psf': '0.55',
        'load-Wu-psf': '-0.80',
        'load-L-psf': '2.10',
        'select-deck-type': 'roof',
        'deck-t-panel': '0.7',
        'deck-fastener-spacing': '300',
        'deck-kphi-override': '12.5',
        'design-KxLx': '2400',
        'design-KyLy': '2600',
        'design-KtLt': '2800',
        'design-Lb': '1800',
        'design-Cb': '1.15',
        'design-Cmx': '0.92',
        'design-Cmy': '0.88',
        'design-P': '12',
        'design-V': '7',
        'design-Mx': '4.5',
        'design-My': '1.2',
        'design-May-strength': '1.8',
        'design-wc-N': '75',
        'design-wc-R': '4.5',
        'design-wc-support': 'ITF',
        'design-wc-fastened': 'unfastened',
        'design-wc-web-config': 'multi_web',
        'design-wc-family': 'multi_web',
        'design-wc-flange-condition': 'unstiffened',
        'design-wc-Lo': '90',
        'design-wc-edge-distance': '110',
        'design-wc-nwebs': '4',
        'design-wc-fastener-spacing': '325',
        'select-template': 'lippedc',
        'tpl-H': '200',
        'tpl-B': '75',
        'tpl-D': '20',
        'tpl-t': '2.3',
        'tpl-r': '4',
        'tpl-qlip': '90',
        'input-fy': '355',
        'plastic-fy': '',
    };
    for (const [id, value] of Object.entries(ids)) {
        doc.ensure(id, value);
    }
    doc.spanLens = [new FakeElement('6.0'), new FakeElement('7.5'), new FakeElement('5.5')];
    doc.supports = [new FakeElement('P'), new FakeElement('F'), new FakeElement('P'), new FakeElement('R')];
    doc.lapL = [undefined, new FakeElement('0.6'), new FakeElement('0.8'), new FakeElement('0.0')];
    doc.lapR = [new FakeElement('0.4'), new FakeElement('0.7'), new FakeElement('0.5'), undefined];
    return doc;
}

function attachSpanBuilder(doc) {
    return function buildSpanTable() {
        const spanType = doc.getElementById('select-span-type')?.value || 'simple';
        const nSpans = spanType === 'cont-n'
            ? Number(doc.getElementById('config-n-spans')?.value || 1)
            : 1;
        doc.spanLens = Array.from({ length: nSpans }, () => new FakeElement('0'));
        doc.supports = Array.from({ length: nSpans + 1 }, () => new FakeElement('P'));
        doc.lapL = Array.from({ length: nSpans + 1 }, (_, idx) => (idx > 0 ? new FakeElement('0') : undefined));
        doc.lapR = Array.from({ length: nSpans + 1 }, (_, idx) => (idx < nSpans ? new FakeElement('0') : undefined));
    };
}

function getNum(doc, id, fallback) {
    const el = doc.getElementById(id);
    const value = el ? parseFloat(el.value) : Number.NaN;
    return Number.isNaN(value) ? fallback : value;
}

function main() {
    const sourceDoc = createBaseDocument();
    const collected = designState.collectDesignInputs({
        document: sourceDoc,
        fromDisplay,
        getNum: (id, fallback) => getNum(sourceDoc, id, fallback),
    });

    approx(collected.wcN, 75 / 25.4, 1e-9, 'wcN');
    approx(collected.wcEdgeDistance, 110 / 25.4, 1e-9, 'wcEdgeDistance');
    approx(collected.wcFastenerSpacing, 325 / 25.4, 1e-9, 'wcFastenerSpacing');
    if (collected.wcSupport !== 'ITF') throw new Error('wcSupport was not collected');
    if (collected.wcFamily !== 'multi_web') throw new Error('wcFamily was not collected');
    if (collected.wcFlangeCondition !== 'unstiffened') throw new Error('wcFlangeCondition was not collected');
    if (collected.wcNWebs !== 4) throw new Error('wcNWebs was not collected');

    const restoredDoc = createBaseDocument();
    restoredDoc.ensure('design-wc-support', 'EOF');
    restoredDoc.ensure('design-wc-fastened', 'fastened');
    restoredDoc.ensure('design-wc-web-config', 'single');
    restoredDoc.ensure('design-wc-family', 'auto');
    restoredDoc.ensure('design-wc-flange-condition', 'stiffened');
    restoredDoc.ensure('design-wc-Lo', '0');
    restoredDoc.ensure('design-wc-edge-distance', '0');
    restoredDoc.ensure('design-wc-nwebs', '1');
    restoredDoc.ensure('design-wc-fastener-spacing', '0');
    restoredDoc.ensure('config-n-spans', '1');
    restoredDoc.ensure('select-span-type', 'simple');

    let syncedFy = null;
    designState.restoreDesignInputs({
        document: restoredDoc,
        toDisplay,
        buildSpanTable: attachSpanBuilder(restoredDoc),
        setTimeoutFn: callback => callback(),
        updateAnalysisFyDisplay: value => {
            syncedFy = value;
        },
    }, collected);

    approx(Number(restoredDoc.getElementById('design-wc-N').value), 75, 1e-9, 'restored wcN display');
    approx(Number(restoredDoc.getElementById('design-wc-edge-distance').value), 110, 1e-9, 'restored wcEdgeDistance display');
    approx(Number(restoredDoc.getElementById('design-wc-fastener-spacing').value), 325, 1e-9, 'restored wcFastenerSpacing display');
    if (restoredDoc.getElementById('design-wc-support').value !== 'ITF') throw new Error('wcSupport was not restored');
    if (restoredDoc.getElementById('design-wc-fastened').value !== 'unfastened') throw new Error('wcFastened was not restored');
    if (restoredDoc.getElementById('design-wc-web-config').value !== 'multi_web') throw new Error('wcWebConfig was not restored');
    if (restoredDoc.getElementById('design-wc-family').value !== 'multi_web') throw new Error('wcFamily was not restored');
    if (restoredDoc.getElementById('design-wc-flange-condition').value !== 'unstiffened') throw new Error('wcFlangeCondition was not restored');
    if (Number(restoredDoc.getElementById('design-wc-nwebs').value) !== 4) throw new Error('wcNWebs was not restored');

    approx(Number(restoredDoc.spanLens[0].value), 6.0, 1e-9, 'restored span 1');
    approx(Number(restoredDoc.spanLens[1].value), 7.5, 1e-9, 'restored span 2');
    approx(Number(restoredDoc.spanLens[2].value), 5.5, 1e-9, 'restored span 3');
    if (restoredDoc.supports[1].value !== 'F') throw new Error('support table was not restored');
    approx(Number(restoredDoc.lapL[1].value), 0.6, 1e-9, 'restored lap left');
    approx(Number(restoredDoc.lapR[2].value), 0.5, 1e-9, 'restored lap right');
    approx(Number(restoredDoc.getElementById('design-fy').value), 345, 1e-9, 'restored design Fy');
    approx(Number(restoredDoc.getElementById('input-fy').value), 345, 1e-9, 'restored input Fy');
    approx(Number(restoredDoc.getElementById('plastic-fy').value), 345, 1e-9, 'restored plastic Fy');
    approx(syncedFy, 345, 1e-9, 'synced Fy');

    console.log('PASS: webview design-state roundtrip');
}

main();
