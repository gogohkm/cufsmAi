"""cFSM element stiffness matrices for single m-term

Ported from MATLAB:
  klocal_transv.m, trans_single.m, assemble_single.m, Kglobal_transv.m
  klocal_m.m, kglocal_m.m, trans_m.m, assemble_m.m, create_Ks.m

Authors (original MATLAB): S. Adany, B. Schafer, Z. Li
"""

import numpy as np
from scipy import sparse
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine.properties import elemprop
from engine.boundary import BC_I1_5


# ---------------------------------------------------------------------------
# Single-m stiffness matrices for transverse constraint matrix (Rp)
# ---------------------------------------------------------------------------

def klocal_transv(Ex, Ey, vx, vy, G, t, a, b, m, BC):
    """Local stiffness matrix for bending terms (single m).

    Only transverse terms are considered (I2..I5 set to zero).
    Membrane moduli enlarged to make membrane strains negligible.

    Ported from klocal_transv.m

    Args:
        Ex, Ey, vx, vy, G: material properties
        t: thickness
        a: member length
        b: element width
        m: half-wave number
        BC: boundary condition string

    Returns:
        k: (8, 8) local stiffness matrix
    """
    E1 = Ex / (1 - vx * vy) * 1e8  # enlarged membrane modulus
    E2 = Ey / (1 - vx * vy)
    Dx = Ex * t**3 / (12 * (1 - vx * vy))
    Dy = Ey * t**3 / (12 * (1 - vx * vy))
    D1 = vx * Ey * t**3 / (12 * (1 - vx * vy))
    Dxy = G * t**3 / 12

    kk = m
    nn = m
    um = kk * math.pi
    up = nn * math.pi
    c1 = um / a
    c2 = up / a

    I1, I2, I3, I4, I5 = BC_I1_5(BC, kk, nn, a)

    # Set I2..I5 to zero for transverse-only
    I2 = 0.0
    I3 = 0.0
    I4 = 0.0
    I5 = 0.0

    # Membrane stiffness (km_mp)
    km_mp = np.zeros((4, 4))
    km_mp[0, 0] = E1 * I1 / b + G * b * I5 / 3
    km_mp[0, 1] = E2 * vx * (-1 / 2 / c2) * I3 - G * I5 / 2 / c2
    km_mp[0, 2] = -E1 * I1 / b + G * b * I5 / 6
    km_mp[0, 3] = E2 * vx * (-1 / 2 / c2) * I3 + G * I5 / 2 / c2

    km_mp[1, 0] = E2 * vx * (-1 / 2 / c1) * I2 - G * I5 / 2 / c1
    km_mp[1, 1] = E2 * b * I4 / 3 / c1 / c2 + G * I5 / b / c1 / c2
    km_mp[1, 2] = E2 * vx * (1 / 2 / c1) * I2 - G * I5 / 2 / c1
    km_mp[1, 3] = E2 * b * I4 / 6 / c1 / c2 - G * I5 / b / c1 / c2

    km_mp[2, 0] = -E1 * I1 / b + G * b * I5 / 6
    km_mp[2, 1] = E2 * vx * (1 / 2 / c2) * I3 - G * I5 / 2 / c2
    km_mp[2, 2] = E1 * I1 / b + G * b * I5 / 3
    km_mp[2, 3] = E2 * vx * (1 / 2 / c2) * I3 + G * I5 / 2 / c2

    km_mp[3, 0] = E2 * vx * (-1 / 2 / c1) * I2 + G * I5 / 2 / c1
    km_mp[3, 1] = E2 * b * I4 / 6 / c1 / c2 - G * I5 / b / c1 / c2
    km_mp[3, 2] = E2 * vx * (1 / 2 / c1) * I2 + G * I5 / 2 / c1
    km_mp[3, 3] = E2 * b * I4 / 3 / c1 / c2 + G * I5 / b / c1 / c2

    km_mp *= t

    # Flexural stiffness (kf_mp)
    kf_mp = np.zeros((4, 4))
    b2 = b**2
    b3 = b**3
    b4 = b**4
    b5 = b**5
    b6 = b**6

    kf_mp[0, 0] = (5040 * Dx * I1 - 504 * b2 * D1 * I2 - 504 * b2 * D1 * I3
                    + 156 * b4 * Dy * I4 + 2016 * b2 * Dxy * I5) / 420 / b3
    kf_mp[0, 1] = (2520 * b * Dx * I1 - 462 * b3 * D1 * I2 - 42 * b3 * D1 * I3
                    + 22 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / 420 / b3
    kf_mp[0, 2] = (-5040 * Dx * I1 + 504 * b2 * D1 * I2 + 504 * b2 * D1 * I3
                    + 54 * b4 * Dy * I4 - 2016 * b2 * Dxy * I5) / 420 / b3
    kf_mp[0, 3] = (2520 * b * Dx * I1 - 42 * b3 * D1 * I2 - 42 * b3 * D1 * I3
                    - 13 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / 420 / b3

    kf_mp[1, 0] = (2520 * b * Dx * I1 - 462 * b3 * D1 * I3 - 42 * b3 * D1 * I2
                    + 22 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / 420 / b3
    kf_mp[1, 1] = (1680 * b2 * Dx * I1 - 56 * b4 * D1 * I2 - 56 * b4 * D1 * I3
                    + 4 * b6 * Dy * I4 + 224 * b4 * Dxy * I5) / 420 / b3
    kf_mp[1, 2] = (-2520 * b * Dx * I1 + 42 * b3 * D1 * I2 + 42 * b3 * D1 * I3
                    + 13 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / 420 / b3
    kf_mp[1, 3] = (840 * b2 * Dx * I1 + 14 * b4 * D1 * I2 + 14 * b4 * D1 * I3
                    - 3 * b6 * Dy * I4 - 56 * b4 * Dxy * I5) / 420 / b3

    kf_mp[2, 0] = kf_mp[0, 2]
    kf_mp[2, 1] = kf_mp[1, 2]
    kf_mp[2, 2] = (5040 * Dx * I1 - 504 * b2 * D1 * I2 - 504 * b2 * D1 * I3
                    + 156 * b4 * Dy * I4 + 2016 * b2 * Dxy * I5) / 420 / b3
    kf_mp[2, 3] = (-2520 * b * Dx * I1 + 462 * b3 * D1 * I2 + 42 * b3 * D1 * I3
                    - 22 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / 420 / b3

    kf_mp[3, 0] = kf_mp[0, 3]
    kf_mp[3, 1] = kf_mp[1, 3]
    kf_mp[3, 2] = (-2520 * b * Dx * I1 + 462 * b3 * D1 * I3 + 42 * b3 * D1 * I2
                    - 22 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / 420 / b3  # not symmetric
    kf_mp[3, 3] = (1680 * b2 * Dx * I1 - 56 * b4 * D1 * I2 - 56 * b4 * D1 * I3
                    + 4 * b6 * Dy * I4 + 224 * b4 * Dxy * I5) / 420 / b3

    # Assemble 8x8 local stiffness
    z0 = np.zeros((4, 4))
    k = np.block([[km_mp, z0],
                   [z0, kf_mp]])
    return k


def trans_single(alpha, k_l):
    """Local-to-global coordinate transformation for single m.

    Ported from trans_single.m

    Args:
        alpha: element inclination angle
        k_l: (8, 8) local stiffness matrix

    Returns:
        k_global: (8, 8) global stiffness matrix
    """
    c = math.cos(alpha)
    s = math.sin(alpha)

    gamma = np.array([
        [ c, 0, 0, 0, -s, 0,  0, 0],
        [ 0, 1, 0, 0,  0, 0,  0, 0],
        [ 0, 0, c, 0,  0, 0, -s, 0],
        [ 0, 0, 0, 1,  0, 0,  0, 0],
        [ s, 0, 0, 0,  c, 0,  0, 0],
        [ 0, 0, 0, 0,  0, 1,  0, 0],
        [ 0, 0, s, 0,  0, 0,  c, 0],
        [ 0, 0, 0, 0,  0, 0,  0, 1],
    ])

    k_global = gamma @ k_l @ gamma.T
    return k_global


def assemble_single(K, k, nodei, nodej, nnodes):
    """Add element contribution to global stiffness matrix (single m).

    Ported from assemble_single.m

    Args:
        K: (4*nnodes, 4*nnodes) global stiffness matrix
        k: (8, 8) element global stiffness matrix
        nodei, nodej: node numbers (1-based MATLAB)
        nnodes: total number of nodes

    Returns:
        K: updated global stiffness matrix
    """
    # Extract 2x2 submatrices
    k11 = k[0:2, 0:2]
    k12 = k[0:2, 2:4]
    k13 = k[0:2, 4:6]
    k14 = k[0:2, 6:8]
    k21 = k[2:4, 0:2]
    k22 = k[2:4, 2:4]
    k23 = k[2:4, 4:6]
    k24 = k[2:4, 6:8]
    k31 = k[4:6, 0:2]
    k32 = k[4:6, 2:4]
    k33 = k[4:6, 4:6]
    k34 = k[4:6, 6:8]
    k41 = k[6:8, 0:2]
    k42 = k[6:8, 2:4]
    k43 = k[6:8, 4:6]
    k44 = k[6:8, 6:8]

    skip = 2 * nnodes
    # Convert 1-based to 0-based indices
    # MATLAB: nodei*2-1:nodei*2 => Python: (nodei-1)*2 : nodei*2
    # But in MATLAB nodei*2-1 with 1-based means the (2*nodei-1)th row
    # which in 0-based is (2*nodei-2)th row = 2*(nodei-1)
    ni = nodei  # keep 1-based for indexing formula
    nj = nodej

    # MATLAB indexing: nodei*2-1:nodei*2 (1-based) = [2*ni-1, 2*ni]
    # Python 0-based: [2*ni-2, 2*ni-1] = slice(2*(ni-1), 2*ni)
    ri = slice(2 * (ni - 1), 2 * ni)
    rj = slice(2 * (nj - 1), 2 * nj)
    si = slice(skip + 2 * (ni - 1), skip + 2 * ni)
    sj = slice(skip + 2 * (nj - 1), skip + 2 * nj)

    # Membrane block (top-left)
    K[ri, ri] += k11
    K[ri, rj] += k12
    K[rj, ri] += k21
    K[rj, rj] += k22

    # Flexural block (bottom-right)
    K[si, si] += k33
    K[si, sj] += k34
    K[sj, si] += k43
    K[sj, sj] += k44

    # Coupling blocks
    K[ri, si] += k13
    K[ri, sj] += k14
    K[rj, si] += k23
    K[rj, sj] += k24

    K[si, ri] += k31
    K[si, rj] += k32
    K[sj, ri] += k41
    K[sj, rj] += k42

    return K


def Kglobal_transv(node, elem, prop, m, a, BC):
    """Global stiffness matrix for planar displacements (single m).

    Ported from Kglobal_transv.m.
    Only w,theta terms considered, with Ey=vx=vy=0.
    Longitudinal DOFs explicitly eliminated.

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5)
        prop: (nmats, 6) -- [matnum, Ex, Ey, vx, vy, G]
        m: half-wave number
        a: member length
        BC: boundary condition string

    Returns:
        K_transv: (4*nnodes, 4*nnodes) global stiffness matrix
    """
    nnode = node.shape[0]
    nelem = elem.shape[0]
    elprop_arr = elemprop(node, elem)
    K_transv = np.zeros((4 * nnode, 4 * nnode))

    for i in range(nelem):
        t = elem[i, 3]
        b = elprop_arr[i, 1]  # width
        matnum = int(elem[i, 4])
        row = np.where(prop[:, 0] == matnum)[0]
        if len(row) == 0:
            row = [0]
        row = row[0]
        Ex = prop[row, 1]
        Ey = prop[row, 2]
        vx = prop[row, 3]
        vy = prop[row, 4]
        G_mat = prop[row, 5]

        k_l = klocal_transv(Ex, Ey, vx, vy, G_mat, t, a, b, m, BC)

        alpha = elprop_arr[i, 2]
        k_g = trans_single(alpha, k_l)

        nodei = int(elem[i, 1])  # 1-based
        nodej = int(elem[i, 2])  # 1-based
        K_transv = assemble_single(K_transv, k_g, nodei, nodej, nnode)

    return K_transv


# ---------------------------------------------------------------------------
# Single-m stiffness matrices for base_update (K, Kg)
# ---------------------------------------------------------------------------

def klocal_m(Ex, Ey, vx, vy, G, t, a, b, m, BC):
    """Local elastic stiffness matrix for single longitudinal term m.

    Ported from klocal_m.m

    Returns:
        k: (8, 8) local elastic stiffness matrix
    """
    E1 = Ex / (1 - vx * vy)
    E2 = Ey / (1 - vx * vy)
    Dx = Ex * t**3 / (12 * (1 - vx * vy))
    Dy = Ey * t**3 / (12 * (1 - vx * vy))
    D1 = vx * Ey * t**3 / (12 * (1 - vx * vy))
    Dxy = G * t**3 / 12

    kk = m
    nn = m
    um = kk * math.pi
    up = nn * math.pi
    c1 = um / a
    c2 = up / a

    I1, I2, I3, I4, I5 = BC_I1_5(BC, kk, nn, a)

    # Membrane stiffness
    km_mp = np.zeros((4, 4))
    km_mp[0, 0] = E1 * I1 / b + G * b * I5 / 3
    km_mp[0, 1] = E2 * vx * (-1 / 2 / c2) * I3 - G * I5 / 2 / c2
    km_mp[0, 2] = -E1 * I1 / b + G * b * I5 / 6
    km_mp[0, 3] = E2 * vx * (-1 / 2 / c2) * I3 + G * I5 / 2 / c2

    km_mp[1, 0] = E2 * vx * (-1 / 2 / c1) * I2 - G * I5 / 2 / c1
    km_mp[1, 1] = E2 * b * I4 / 3 / c1 / c2 + G * I5 / b / c1 / c2
    km_mp[1, 2] = E2 * vx * (1 / 2 / c1) * I2 - G * I5 / 2 / c1
    km_mp[1, 3] = E2 * b * I4 / 6 / c1 / c2 - G * I5 / b / c1 / c2

    km_mp[2, 0] = -E1 * I1 / b + G * b * I5 / 6
    km_mp[2, 1] = E2 * vx * (1 / 2 / c2) * I3 - G * I5 / 2 / c2
    km_mp[2, 2] = E1 * I1 / b + G * b * I5 / 3
    km_mp[2, 3] = E2 * vx * (1 / 2 / c2) * I3 + G * I5 / 2 / c2

    km_mp[3, 0] = E2 * vx * (-1 / 2 / c1) * I2 + G * I5 / 2 / c1
    km_mp[3, 1] = E2 * b * I4 / 6 / c1 / c2 - G * I5 / b / c1 / c2
    km_mp[3, 2] = E2 * vx * (1 / 2 / c1) * I2 + G * I5 / 2 / c1
    km_mp[3, 3] = E2 * b * I4 / 3 / c1 / c2 + G * I5 / b / c1 / c2
    km_mp *= t

    # Flexural stiffness
    kf_mp = np.zeros((4, 4))
    b2 = b**2
    b3 = b**3
    b4 = b**4
    b5 = b**5
    b6 = b**6

    kf_mp[0, 0] = (5040 * Dx * I1 - 504 * b2 * D1 * I2 - 504 * b2 * D1 * I3
                    + 156 * b4 * Dy * I4 + 2016 * b2 * Dxy * I5) / 420 / b3
    kf_mp[0, 1] = (2520 * b * Dx * I1 - 462 * b3 * D1 * I2 - 42 * b3 * D1 * I3
                    + 22 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / 420 / b3
    kf_mp[0, 2] = (-5040 * Dx * I1 + 504 * b2 * D1 * I2 + 504 * b2 * D1 * I3
                    + 54 * b4 * Dy * I4 - 2016 * b2 * Dxy * I5) / 420 / b3
    kf_mp[0, 3] = (2520 * b * Dx * I1 - 42 * b3 * D1 * I2 - 42 * b3 * D1 * I3
                    - 13 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / 420 / b3

    kf_mp[1, 0] = (2520 * b * Dx * I1 - 462 * b3 * D1 * I3 - 42 * b3 * D1 * I2
                    + 22 * b5 * Dy * I4 + 168 * b3 * Dxy * I5) / 420 / b3
    kf_mp[1, 1] = (1680 * b2 * Dx * I1 - 56 * b4 * D1 * I2 - 56 * b4 * D1 * I3
                    + 4 * b6 * Dy * I4 + 224 * b4 * Dxy * I5) / 420 / b3
    kf_mp[1, 2] = (-2520 * b * Dx * I1 + 42 * b3 * D1 * I2 + 42 * b3 * D1 * I3
                    + 13 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / 420 / b3
    kf_mp[1, 3] = (840 * b2 * Dx * I1 + 14 * b4 * D1 * I2 + 14 * b4 * D1 * I3
                    - 3 * b6 * Dy * I4 - 56 * b4 * Dxy * I5) / 420 / b3

    kf_mp[2, 0] = kf_mp[0, 2]
    kf_mp[2, 1] = kf_mp[1, 2]
    kf_mp[2, 2] = (5040 * Dx * I1 - 504 * b2 * D1 * I2 - 504 * b2 * D1 * I3
                    + 156 * b4 * Dy * I4 + 2016 * b2 * Dxy * I5) / 420 / b3
    kf_mp[2, 3] = (-2520 * b * Dx * I1 + 462 * b3 * D1 * I2 + 42 * b3 * D1 * I3
                    - 22 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / 420 / b3

    kf_mp[3, 0] = kf_mp[0, 3]
    kf_mp[3, 1] = kf_mp[1, 3]
    kf_mp[3, 2] = (-2520 * b * Dx * I1 + 462 * b3 * D1 * I3 + 42 * b3 * D1 * I2
                    - 22 * b5 * Dy * I4 - 168 * b3 * Dxy * I5) / 420 / b3  # not symmetric
    kf_mp[3, 3] = (1680 * b2 * Dx * I1 - 56 * b4 * D1 * I2 - 56 * b4 * D1 * I3
                    + 4 * b6 * Dy * I4 + 224 * b4 * Dxy * I5) / 420 / b3

    # Assemble 8x8
    z0 = np.zeros((4, 4))
    k = np.block([[km_mp, z0],
                   [z0, kf_mp]])
    return k


def kglocal_m(a, b, m, Ty1, Ty2, BC):
    """Local geometric stiffness matrix for single longitudinal term m.

    Ported from kglocal_m.m

    Returns:
        kg: (8, 8) local geometric stiffness matrix
    """
    kk = m
    nn = m
    um = kk * math.pi
    up = nn * math.pi

    I1, I2, I3, I4, I5 = BC_I1_5(BC, kk, nn, a)

    # Membrane geometric stiffness
    gm_mp = np.zeros((4, 4))
    gm_mp[0, 0] = b * (3 * Ty1 + Ty2) * I5 / 12
    gm_mp[0, 2] = b * (Ty1 + Ty2) * I5 / 12
    gm_mp[2, 0] = gm_mp[0, 2]
    gm_mp[1, 1] = b * a**2 * (3 * Ty1 + Ty2) * I4 / 12 / um / up
    gm_mp[1, 3] = b * a**2 * (Ty1 + Ty2) * I4 / 12 / um / up
    gm_mp[3, 1] = gm_mp[1, 3]
    gm_mp[2, 2] = b * (Ty1 + 3 * Ty2) * I5 / 12
    gm_mp[3, 3] = b * a**2 * (Ty1 + 3 * Ty2) * I4 / 12 / um / up

    # Flexural geometric stiffness
    gf_mp = np.zeros((4, 4))
    gf_mp[0, 0] = (10 * Ty1 + 3 * Ty2) * b * I5 / 35
    gf_mp[0, 1] = (15 * Ty1 + 7 * Ty2) * b**2 * I5 / 210 / 2
    gf_mp[1, 0] = gf_mp[0, 1]
    gf_mp[0, 2] = 9 * (Ty1 + Ty2) * b * I5 / 140
    gf_mp[2, 0] = gf_mp[0, 2]
    gf_mp[0, 3] = -(7 * Ty1 + 6 * Ty2) * b**2 * I5 / 420
    gf_mp[3, 0] = gf_mp[0, 3]
    gf_mp[1, 1] = (5 * Ty1 + 3 * Ty2) * b**3 * I5 / 2 / 420
    gf_mp[1, 2] = (6 * Ty1 + 7 * Ty2) * b**2 * I5 / 420
    gf_mp[2, 1] = gf_mp[1, 2]
    gf_mp[1, 3] = -(Ty1 + Ty2) * b**3 * I5 / 140 / 2
    gf_mp[3, 1] = gf_mp[1, 3]
    gf_mp[2, 2] = (3 * Ty1 + 10 * Ty2) * b * I5 / 35
    gf_mp[2, 3] = -(7 * Ty1 + 15 * Ty2) * b**2 * I5 / 420
    gf_mp[3, 2] = gf_mp[2, 3]
    gf_mp[3, 3] = (3 * Ty1 + 5 * Ty2) * b**3 * I5 / 420 / 2

    # Assemble 8x8
    z0 = np.zeros((4, 4))
    kg = np.block([[gm_mp, z0],
                    [z0, gf_mp]])
    return kg


def trans_m(alpha, k_l, kg_l):
    """Local-to-global transformation for single m (K and Kg).

    Ported from trans_m.m

    Returns:
        (k_global, kg_global)
    """
    c = math.cos(alpha)
    s = math.sin(alpha)

    gamma = np.array([
        [ c, 0, 0, 0, -s, 0,  0, 0],
        [ 0, 1, 0, 0,  0, 0,  0, 0],
        [ 0, 0, c, 0,  0, 0, -s, 0],
        [ 0, 0, 0, 1,  0, 0,  0, 0],
        [ s, 0, 0, 0,  c, 0,  0, 0],
        [ 0, 0, 0, 0,  0, 1,  0, 0],
        [ 0, 0, s, 0,  0, 0,  c, 0],
        [ 0, 0, 0, 0,  0, 0,  0, 1],
    ])

    k_global = gamma @ k_l @ gamma.T
    kg_global = gamma @ kg_l @ gamma.T
    return k_global, kg_global


def assemble_m(K, Kg, k, kg, nodei, nodej, nnodes):
    """Add element contribution to global K and Kg (single m).

    Ported from assemble_m.m

    Args:
        K, Kg: (4*nnodes, 4*nnodes) global matrices
        k, kg: (8, 8) element global matrices
        nodei, nodej: 1-based node numbers
        nnodes: total nodes

    Returns:
        (K, Kg): updated matrices
    """
    # Extract 2x2 submatrices
    k11 = k[0:2, 0:2];  k12 = k[0:2, 2:4];  k13 = k[0:2, 4:6];  k14 = k[0:2, 6:8]
    k21 = k[2:4, 0:2];  k22 = k[2:4, 2:4];  k23 = k[2:4, 4:6];  k24 = k[2:4, 6:8]
    k31 = k[4:6, 0:2];  k32 = k[4:6, 2:4];  k33 = k[4:6, 4:6];  k34 = k[4:6, 6:8]
    k41 = k[6:8, 0:2];  k42 = k[6:8, 2:4];  k43 = k[6:8, 4:6];  k44 = k[6:8, 6:8]

    kg11 = kg[0:2, 0:2]; kg12 = kg[0:2, 2:4]; kg13 = kg[0:2, 4:6]; kg14 = kg[0:2, 6:8]
    kg21 = kg[2:4, 0:2]; kg22 = kg[2:4, 2:4]; kg23 = kg[2:4, 4:6]; kg24 = kg[2:4, 6:8]
    kg31 = kg[4:6, 0:2]; kg32 = kg[4:6, 2:4]; kg33 = kg[4:6, 4:6]; kg34 = kg[4:6, 6:8]
    kg41 = kg[6:8, 0:2]; kg42 = kg[6:8, 2:4]; kg43 = kg[6:8, 4:6]; kg44 = kg[6:8, 6:8]

    skip = 2 * nnodes
    ni = nodei  # 1-based
    nj = nodej

    ri = slice(2 * (ni - 1), 2 * ni)
    rj = slice(2 * (nj - 1), 2 * nj)
    si = slice(skip + 2 * (ni - 1), skip + 2 * ni)
    sj = slice(skip + 2 * (nj - 1), skip + 2 * nj)

    # K assembly
    K[ri, ri] += k11;  K[ri, rj] += k12;  K[rj, ri] += k21;  K[rj, rj] += k22
    K[si, si] += k33;  K[si, sj] += k34;  K[sj, si] += k43;  K[sj, sj] += k44
    K[ri, si] += k13;  K[ri, sj] += k14;  K[rj, si] += k23;  K[rj, sj] += k24
    K[si, ri] += k31;  K[si, rj] += k32;  K[sj, ri] += k41;  K[sj, rj] += k42

    # Kg assembly
    Kg[ri, ri] += kg11; Kg[ri, rj] += kg12; Kg[rj, ri] += kg21; Kg[rj, rj] += kg22
    Kg[si, si] += kg33; Kg[si, sj] += kg34; Kg[sj, si] += kg43; Kg[sj, sj] += kg44
    Kg[ri, si] += kg13; Kg[ri, sj] += kg14; Kg[rj, si] += kg23; Kg[rj, sj] += kg24
    Kg[si, ri] += kg31; Kg[si, rj] += kg32; Kg[sj, ri] += kg41; Kg[sj, rj] += kg42

    return K, Kg


def create_Ks(m, node, elem, elprop_arr, prop, a, BC):
    """Create global K and Kg for a single longitudinal term m.

    Ported from create_Ks.m. Called from base_update.

    Args:
        m: half-wave number
        node: (nnodes, 8)
        elem: (nelems, 5)
        elprop_arr: (nelems, 3) -- element properties
        prop: (nmats, 6) -- material properties
        a: member length
        BC: boundary condition string

    Returns:
        (K, Kg): sparse (4*nnodes, 4*nnodes) matrices
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    K = np.zeros((4 * nnodes, 4 * nnodes))
    Kg = np.zeros((4 * nnodes, 4 * nnodes))

    for i in range(nelems):
        t = elem[i, 3]
        b = elprop_arr[i, 1]  # width
        matnum = int(elem[i, 4])
        row = np.where(prop[:, 0] == matnum)[0]
        if len(row) == 0:
            row = [0]
        row = row[0]
        Ex = prop[row, 1]
        Ey = prop[row, 2]
        vx = prop[row, 3]
        vy = prop[row, 4]
        G_mat = prop[row, 5]

        k_l = klocal_m(Ex, Ey, vx, vy, G_mat, t, a, b, m, BC)

        # Geometric stiffness
        nodei_idx = int(elem[i, 1])  # 1-based
        nodej_idx = int(elem[i, 2])  # 1-based
        Ty1 = node[nodei_idx - 1, 7] * t  # stress * t
        Ty2 = node[nodej_idx - 1, 7] * t

        kg_l = kglocal_m(a, b, m, Ty1, Ty2, BC)

        alpha = elprop_arr[i, 2]
        k_g, kg_g = trans_m(alpha, k_l, kg_l)

        K, Kg = assemble_m(K, Kg, k_g, kg_g, nodei_idx, nodej_idx, nnodes)

    return K, Kg
