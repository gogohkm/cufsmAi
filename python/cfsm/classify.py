"""cFSM modal classification -- classify buckling modes as G/D/L/O

Ported from MATLAB:
  classify.m, mode_class.m, mode_class2.m

Authors (original MATLAB): S. Adany, B. Schafer, Z. Li
"""

import numpy as np
from scipy import linalg as la
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


def classify(prop, node, elem, lengths, shapes, GBTcon, BC, m_all):
    """Perform modal classification of buckling modes.

    Ported from classify.m

    Args:
        prop: (nmats, 6) -- [matnum, Ex, Ey, vx, vy, G]
        node: (nnodes, 8) -- [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) -- [elem#, nodei, nodej, t, matnum]
        lengths: array of analysis lengths
        shapes: list of mode shape arrays, shapes[i] = (ndof, nmodes)
        GBTcon: GBT configuration object with attributes:
            .ospace: O-space option (1-4)
            .norm: normalization (0-3)
            .couple: 1=uncoupled, 2=coupled
            .orth: 1=natural, 2=modal(axial), 3=modal(load)
        BC: boundary condition string
        m_all: list of arrays, m_all[i] = longitudinal terms for length i

    Returns:
        clas: list of arrays, clas[i] = (nmodes, 4) [%G, %D, %L, %O]
    """
    from .base_vectors import base_column, base_update
    from engine.helpers import msort

    nnodes = node.shape[0]
    ndof_m = 4 * nnodes

    # Clean up m_all
    m_all = msort(m_all)

    nlengths = len(lengths)
    clas = []

    for l_idx in range(nlengths):
        a = lengths[l_idx]
        m_a = m_all[l_idx]

        # Generate base vectors
        b_v_l, ngm, ndm, nlm = base_column(node, elem, prop, a, BC, m_a)

        # Get GBTcon parameters
        ospace = getattr(GBTcon, 'ospace', 1) if GBTcon else 1
        norm_type = getattr(GBTcon, 'norm', 0) if GBTcon else 0
        couple = getattr(GBTcon, 'couple', 1) if GBTcon else 1
        orth_type = getattr(GBTcon, 'orth', 1) if GBTcon else 1

        # Orthonormal vectors
        b_v = base_update(ospace, norm_type, b_v_l, a, m_a, node, elem, prop,
                          ngm, ndm, nlm, BC, couple, orth_type)

        # Classification for each mode at this length
        shape_mat = shapes[l_idx]
        if shape_mat is None or (hasattr(shape_mat, 'size') and shape_mat.size == 0):
            clas.append(np.zeros((1, 4)))
            continue

        if isinstance(shape_mat, np.ndarray):
            if shape_mat.ndim == 1:
                n_modes = 1
                shape_mat = shape_mat.reshape(-1, 1)
            else:
                n_modes = shape_mat.shape[1]
        else:
            n_modes = 1
            shape_mat = np.array(shape_mat).reshape(-1, 1)

        clas_l = np.zeros((n_modes, 4))
        for mod in range(n_modes):
            mode_vec = shape_mat[:, mod]
            clas_l[mod, :] = mode_class(b_v, mode_vec, ngm, ndm, nlm,
                                         m_a, ndof_m, couple)

        clas.append(clas_l)

    return clas


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
        clas_gdlo: (4,) array [%G, %D, %L, %O]
    """
    totalm = len(hwn)

    # DOF indices
    dofindex = np.zeros((4, 2), dtype=int)
    dofindex[0] = [0, ngm - 1]
    dofindex[1] = [ngm, ngm + ndm - 1]
    dofindex[2] = [ngm + ndm, ngm + ndm + nlm - 1]
    dofindex[3] = [ngm + ndm + nlm, ndof_m - 1]

    if couple == 1:
        # Uncoupled basis
        cl_gdlo = [[], [], [], []]

        for ml in range(totalm):
            r0 = ndof_m * ml
            r1 = ndof_m * (ml + 1)

            b_v_m = b_v[r0:r1, r0:r1]
            displ_m = displ[r0:r1]

            # Solve for coefficients: b_v_m * clas = displ_m
            try:
                clas_coeffs = np.linalg.solve(b_v_m, displ_m)
            except np.linalg.LinAlgError:
                clas_coeffs = np.linalg.lstsq(b_v_m, displ_m, rcond=None)[0]

            for i in range(4):
                di0 = dofindex[i, 0]
                di1 = dofindex[i, 1] + 1
                NModes = di1 - di0
                cl_gdlo[i].extend(clas_coeffs[di0:di1].tolist())

        # L2 norm
        clas_gdlo = np.zeros(4)
        for mn in range(4):
            clas_gdlo[mn] = np.linalg.norm(cl_gdlo[mn])
        NormSum = np.sum(clas_gdlo)
        if NormSum > 1e-15:
            clas_gdlo = clas_gdlo / NormSum * 100.0
        else:
            clas_gdlo = np.array([25.0, 25.0, 25.0, 25.0])

    else:
        # Coupled basis
        try:
            clas_coeffs = np.linalg.solve(b_v, displ)
        except np.linalg.LinAlgError:
            clas_coeffs = np.linalg.lstsq(b_v, displ, rcond=None)[0]

        v_gdlo = [[], [], [], []]
        for i in range(4):
            for j in range(totalm):
                di0 = dofindex[i, 0]
                di1 = dofindex[i, 1] + 1
                NModes = di1 - di0
                v_gdlo[i].extend(
                    clas_coeffs[j * ndof_m + di0:j * ndof_m + di1].tolist()
                )

        clas_gdlo = np.zeros(4)
        for i in range(4):
            clas_gdlo[i] = np.linalg.norm(v_gdlo[i])
        NormSum = np.sum(clas_gdlo)
        if NormSum > 1e-15:
            clas_gdlo = clas_gdlo / NormSum * 100.0
        else:
            clas_gdlo = np.array([25.0, 25.0, 25.0, 25.0])

    return clas_gdlo


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
        GDLO_DirectSum: (4,) percentage array
        GDLO_WeightedFactor: 0 (placeholder)
    """
    dofindex = np.zeros((4, 2), dtype=int)
    dofindex[0] = [0, ngm - 1]
    dofindex[1] = [ngm, ngm + ndm - 1]
    dofindex[2] = [ngm + ndm, ngm + ndm + nlm - 1]
    dofindex[3] = [ngm + ndm + nlm, ndof_m - 1]

    # Solve for coefficients
    try:
        clas_coeffs = np.linalg.solve(b_v, displ)
    except np.linalg.LinAlgError:
        clas_coeffs = np.linalg.lstsq(b_v, displ, rcond=None)[0]

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
    if total > 1e-15:
        GDLO_DirectSum = clas_gdlo / total * 100.0
    else:
        GDLO_DirectSum = np.array([25.0, 25.0, 25.0, 25.0])

    GDLO_WeightedFactor = 0.0
    return GDLO_DirectSum, GDLO_WeightedFactor
