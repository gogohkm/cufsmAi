"""cFSM modal classification -- classify buckling modes as G/D/L/O

Ported from MATLAB:
  classify.m, mode_class.m, mode_class2.m

Authors (original MATLAB): S. Adany, B. Schafer, Z. Li

A classification that cannot be trusted is returned as a row of NaN, never as a
plausible percentage split: models outside classical cFSM (rounded corners meshed
as arcs, closed or branched sections, disconnected parts) and any length or mode
whose decomposition fails. The returned list carries the reason
(``CfsmClassification.status`` / ``.code`` / ``.message`` / ``.diagnostics``).
"""

import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# CUFSM's own defaults for modal classification (Ref_Source/helpers/loader.m:135-145,
# examples/batchcufsm5.m:169): ST O-space, uncoupled, modal basis with axial
# orthogonality, vector norm. Used when classify() is called with GBTcon=None.
CUFSM_CLASSIFY_DEFAULTS = {'ospace': 1, 'orth': 2, 'couple': 1, 'norm': 1}

# ospace follows MATLAB base_update.m: 1-4 for the uncoupled basis, 1-5 for the
# coupled one (couple=2: 3 = K, 4 = Kg, 5 = vector null space).
_VALID = {'ospace': (1, 2, 3, 4, 5), 'orth': (1, 2, 3), 'couple': (1, 2), 'norm': (0, 1, 2, 3)}

# relative residual of the basis solve above which the decomposition is rejected
_RESIDUAL_TOL = 1e-6
# Always-true scope of this classification (FIXES §3.1.1 scope_notes)
CFSM_SCOPE_NOTES = (
    'Classical cFSM (GBT) classification: open, unbranched cross-sections of flat plates '
    'with sharp corners only; other models are not classified (empty/null rows).',
    'The G/D/L/O percentages are per mode space and depend on the basis options '
    '(orth, norm); CUFSM classifies with orth=2, norm=1.',
)

# basis condition number above which the decomposition is not unique
_COND_MAX = 1e12


class CfsmClassification(list):
    """Per-length classification: ``clas[i]`` is an (nmodes, 4) array
    [%G, %D, %L, %O] (NaN rows where no classification is possible).

    Attributes:
        status: 'ok' (every row classified), 'partial' (some NaN rows) or
            'unsupported' (the model is outside classical cFSM; all rows NaN)
        supported: False when status == 'unsupported'
        code: None or the reason code of :func:`cfsm.node_utils.check_cfsm_model`
        message: human readable reason ('' when ok)
        diagnostics: list of {'severity', 'code', 'length_index', 'length', 'message'}
        settings: the basis options used {'ospace', 'orth', 'couple', 'norm'}
        warnings / assumptions / scope_notes: message lists split per FIXES §3.1.1 --
            warnings: rows left NaN and why (the result changed); assumptions: basis
            options filled with CUFSM defaults; scope_notes: CFSM_SCOPE_NOTES.
    """

    def __init__(self, rows=(), status='ok', code=None, message='',
                 diagnostics=None, settings=None, assumptions=None):
        super().__init__(rows)
        self.status = status
        self.supported = status != 'unsupported'
        self.code = code
        self.message = message
        self.diagnostics = list(diagnostics or [])
        self.settings = dict(settings or {})
        self.warnings = [d['message'] for d in self.diagnostics
                         if d.get('severity') in ('warning', 'error')]
        self.assumptions = list(assumptions or [])
        self.scope_notes = list(CFSM_SCOPE_NOTES)

    def summary(self) -> dict:
        """JSON-friendly description of the classification status."""
        return {'status': self.status, 'supported': self.supported,
                'code': self.code, 'message': self.message,
                'settings': dict(self.settings),
                'diagnostics': list(self.diagnostics),
                'warnings': list(self.warnings),
                'assumptions': list(self.assumptions),
                'scope_notes': list(self.scope_notes)}


def _settings_from(GBTcon):
    """(settings, names of the options filled with CUFSM defaults)."""
    if GBTcon is None:
        settings = dict(CUFSM_CLASSIFY_DEFAULTS)
    elif isinstance(GBTcon, dict):
        settings = {k: GBTcon.get(k, v) for k, v in CUFSM_CLASSIFY_DEFAULTS.items()}
    else:
        settings = {k: getattr(GBTcon, k, v) for k, v in CUFSM_CLASSIFY_DEFAULTS.items()}
    if GBTcon is None:
        defaulted = list(CUFSM_CLASSIFY_DEFAULTS)
    elif isinstance(GBTcon, dict):
        defaulted = [k for k in CUFSM_CLASSIFY_DEFAULTS if k not in GBTcon]
    else:
        defaulted = [k for k in CUFSM_CLASSIFY_DEFAULTS if not hasattr(GBTcon, k)]
    out = {}
    for k, v in settings.items():
        try:
            iv = int(v)
        except (TypeError, ValueError):
            iv = None
        if iv is None or iv != v or iv not in _VALID[k]:
            raise ValueError(f"cFSM classification: {k}={v!r} is not one of {_VALID[k]}")
        out[k] = iv
    if out['couple'] == 1 and out['ospace'] == 5:
        raise ValueError("cFSM classification: ospace=5 exists only for the coupled basis "
                         "(couple=2); the uncoupled basis uses ospace 1-4")
    return out, defaulted


def _n_modes(shape_mat):
    if shape_mat is None:
        return 1
    arr = np.asarray(shape_mat)
    if arr.size == 0:
        return 1
    return 1 if arr.ndim == 1 else arr.shape[1]


def classify(prop, node, elem, lengths, shapes, GBTcon, BC, m_all):
    """Perform modal classification of buckling modes.

    Ported from classify.m

    Args:
        prop: (nmats, 6) -- [matnum, Ex, Ey, vx, vy, G]
        node: (nnodes, 8) -- [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) -- [elem#, nodei, nodej, t, matnum]
        lengths: array of analysis lengths
        shapes: list of mode shape arrays, shapes[i] = (ndof, nmodes)
        GBTcon: basis options object or dict with
            .ospace: O-space option -- MATLAB numbering, which differs per basis:
                couple=1: 1 ST, 2 K, 3 Kg, 4 vector; couple=2: 1/2 ST, 3 K, 4 Kg, 5 vector
            .norm: normalization (0-3)
            .couple: 1=uncoupled, 2=coupled
            .orth: 1=natural, 2=modal(axial), 3=modal(load)
            None selects CUFSM's defaults (ospace=1, orth=2, couple=1, norm=1);
            a missing attribute takes the CUFSM default.
        BC: boundary condition string
        m_all: list of arrays, m_all[i] = longitudinal terms for length i

    Returns:
        CfsmClassification (a list): clas[i] = (nmodes, 4) [%G, %D, %L, %O],
        NaN rows where the mode cannot be classified.

    The percentages are per *space* (G, D, L, O). Spaces do not depend on orth or
    norm, but the contribution split does (non-orthogonal natural basis vs modal
    basis), which is why CUFSM classifies with orth=2, norm=1. Individual mode
    indices inside a space are basis dependent (see base_update).
    """
    from .base_vectors import base_column, base_update
    from .node_utils import check_cfsm_model
    from engine.helpers import msort

    settings, defaulted = _settings_from(GBTcon)
    assumptions = []
    if defaulted:
        assumptions.append(
            'cFSM basis options not given (' + ', '.join(defaulted) + ') were set to '
            "CUFSM's classification defaults: " +
            ', '.join(f'{k}={settings[k]}' for k in defaulted) + '.')
    nnodes = node.shape[0]
    ndof_m = 4 * nnodes
    nlengths = len(lengths)

    chk = check_cfsm_model(node, elem)
    if not chk['supported']:
        rows = [np.full((_n_modes(shapes[i] if i < len(shapes) else None), 4), np.nan)
                for i in range(nlengths)]
        diag = [{'severity': 'warning', 'code': 'CFSM_UNSUPPORTED_MODEL',
                 'length_index': None, 'length': None,
                 'message': f"cFSM classification not performed: {chk['message']}"}]
        return CfsmClassification(rows, status='unsupported', code=chk['code'],
                                  message=chk['message'], diagnostics=diag,
                                  settings=settings, assumptions=assumptions)

    # Clean up m_all
    m_all = msort(m_all)

    clas = []
    diagnostics = []

    for l_idx in range(nlengths):
        a = lengths[l_idx]
        m_a = m_all[l_idx]
        shape_mat = shapes[l_idx] if l_idx < len(shapes) else None
        n_modes = _n_modes(shape_mat)

        def fail(code, msg, _l_idx=l_idx, _a=a, _n=n_modes):
            diagnostics.append({'severity': 'warning', 'code': code,
                                'length_index': _l_idx, 'length': float(_a),
                                'message': msg})
            clas.append(np.full((_n, 4), np.nan))

        if shape_mat is None or np.asarray(shape_mat).size == 0:
            fail('NO_MODE_SHAPE', 'No mode shape at this length; not classified.')
            continue

        try:
            # Generate base vectors
            b_v_l, ngm, ndm, nlm = base_column(node, elem, prop, a, BC, m_a)
            # Orthonormal vectors
            b_v = base_update(settings['ospace'], settings['norm'], b_v_l, a, m_a,
                              node, elem, prop, ngm, ndm, nlm, BC,
                              settings['couple'], settings['orth'])
        except Exception as exc:
            fail('CFSM_BASIS_FAILED',
                 f'cFSM base vectors could not be formed ({type(exc).__name__}: {exc}).')
            continue

        # A rank-deficient basis (e.g. a single flat plate: only 2 global modes)
        # makes the G/D/L/O coefficients non-unique, so any split is arbitrary.
        blocks = ([b_v[k * ndof_m:(k + 1) * ndof_m, k * ndof_m:(k + 1) * ndof_m]
                   for k in range(len(m_a))] if settings['couple'] == 1 else [b_v])
        cond = max(np.linalg.cond(blk) for blk in blocks)
        if not np.isfinite(cond) or cond > _COND_MAX:
            fail('CFSM_BASIS_SINGULAR',
                 f'The cFSM basis is singular for this model (cond = {cond:.1e}); '
                 'the G/D/L/O split is not unique.')
            continue

        shape_mat = np.asarray(shape_mat, dtype=float)
        if shape_mat.ndim == 1:
            shape_mat = shape_mat.reshape(-1, 1)
        if shape_mat.shape[0] != b_v.shape[0]:
            fail('SHAPE_SIZE_MISMATCH',
                 f'Mode shape has {shape_mat.shape[0]} DOFs but the model and '
                 f'longitudinal terms need {b_v.shape[0]}; not classified.')
            continue

        clas_l = np.zeros((n_modes, 4))
        n_bad = 0
        for mod in range(n_modes):
            clas_l[mod, :] = mode_class(b_v, shape_mat[:, mod], ngm, ndm, nlm,
                                        m_a, ndof_m, settings['couple'])
            if not np.all(np.isfinite(clas_l[mod, :])):
                n_bad += 1
        if n_bad:
            diagnostics.append({
                'severity': 'warning', 'code': 'MODE_NOT_CLASSIFIED',
                'length_index': l_idx, 'length': float(a),
                'message': f'{n_bad} of {n_modes} mode(s) could not be decomposed '
                           'into the cFSM basis (zero or non-representable shape).'})
        clas.append(clas_l)

    any_nan = any(not np.all(np.isfinite(c)) for c in clas)
    return CfsmClassification(
        clas, status='partial' if any_nan else 'ok',
        message='some modes could not be classified' if any_nan else '',
        diagnostics=diagnostics, settings=settings, assumptions=assumptions)


def _solve_coeffs(b_v, displ):
    """Coefficients c with b_v c = displ, or None when the basis cannot
    represent the vector (singular basis, zero or non-finite vector)."""
    displ = np.asarray(displ, dtype=float)
    dn = np.linalg.norm(displ)
    if not np.isfinite(dn) or dn == 0.0 or not np.all(np.isfinite(b_v)):
        return None
    try:
        c = np.linalg.solve(b_v, displ)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.isfinite(c)):
        return None
    if np.linalg.norm(b_v @ c - displ) > _RESIDUAL_TOL * dn:
        return None
    return c


def mode_class(b_v, displ, ngm, ndm, nlm, hwn, ndof_m, couple):
    """Determine mode contribution (G/D/L/O percentages).

    Uses L2 norm classification.
    Ported from mode_class.m

    Args:
        b_v: base vectors matrix
        displ: displacement vector
        ngm, ndm, nlm: mode counts
        hwn: half-wave numbers array
        ndof_m: DOF per m-term
        couple: 1=uncoupled, 2=coupled

    Returns:
        clas_gdlo: (4,) array [%G, %D, %L, %O]; NaN when the vector cannot be
        decomposed (MATLAB gives NaN through 0/0 in the same cases).
    """
    totalm = len(hwn)
    nan4 = np.full(4, np.nan)

    # DOF indices
    dofindex = np.zeros((4, 2), dtype=int)
    dofindex[0] = [0, ngm - 1]
    dofindex[1] = [ngm, ngm + ndm - 1]
    dofindex[2] = [ngm + ndm, ngm + ndm + nlm - 1]
    dofindex[3] = [ngm + ndm + nlm, ndof_m - 1]

    cl_gdlo = [[], [], [], []]
    if couple == 1:
        # Uncoupled basis: block-diagonal, solve each m-term separately
        for ml in range(totalm):
            r0 = ndof_m * ml
            r1 = ndof_m * (ml + 1)
            displ_m = np.asarray(displ[r0:r1], dtype=float)
            if np.linalg.norm(displ_m) == 0.0:
                continue  # this m-term does not take part in the mode
            clas_coeffs = _solve_coeffs(b_v[r0:r1, r0:r1], displ_m)
            if clas_coeffs is None:
                return nan4
            for i in range(4):
                cl_gdlo[i].extend(clas_coeffs[dofindex[i, 0]:dofindex[i, 1] + 1].tolist())
    else:
        # Coupled basis
        clas_coeffs = _solve_coeffs(b_v, displ)
        if clas_coeffs is None:
            return nan4
        for i in range(4):
            for j in range(totalm):
                cl_gdlo[i].extend(
                    clas_coeffs[j * ndof_m + dofindex[i, 0]:j * ndof_m + dofindex[i, 1] + 1].tolist())

    # L2 norm
    clas_gdlo = np.array([np.linalg.norm(c) if c else 0.0 for c in cl_gdlo])
    NormSum = np.sum(clas_gdlo)
    if not np.isfinite(NormSum) or NormSum <= 0.0:
        return nan4
    return clas_gdlo / NormSum * 100.0


def mode_class2(b_v, displ, ngm, ndm, nlm, hwn, ndof_m):
    """Alternative mode classification (direct sum method).

    Ported from mode_class2.m

    Args:
        b_v: base vectors matrix
        displ: displacement vector
        ngm, ndm, nlm: mode counts
        hwn: half-wave numbers
        ndof_m: DOF per m-term

    Returns:
        GDLO_DirectSum: (4,) percentage array (NaN when not decomposable)
        GDLO_WeightedFactor: 0 (placeholder)
    """
    dofindex = np.zeros((4, 2), dtype=int)
    dofindex[0] = [0, ngm - 1]
    dofindex[1] = [ngm, ngm + ndm - 1]
    dofindex[2] = [ngm + ndm, ngm + ndm + nlm - 1]
    dofindex[3] = [ngm + ndm + nlm, ndof_m - 1]

    # Solve for coefficients
    clas_coeffs = _solve_coeffs(b_v, displ)
    if clas_coeffs is None:
        return np.full(4, np.nan), 0.0

    clas_coeffs = np.abs(clas_coeffs)
    totalm = len(hwn)

    clas_gdlo = np.zeros(4)
    for i in range(4):
        for j in range(totalm):
            di0 = dofindex[i, 0]
            di1 = dofindex[i, 1] + 1
            clas_gdlo[i] += np.sum(
                clas_coeffs[j * ndof_m + di0:j * ndof_m + di1]
            )

    total = np.sum(clas_coeffs)
    if total > 0.0:
        GDLO_DirectSum = clas_gdlo / total * 100.0
    else:
        GDLO_DirectSum = np.full(4, np.nan)

    GDLO_WeightedFactor = 0.0
    return GDLO_DirectSum, GDLO_WeightedFactor
