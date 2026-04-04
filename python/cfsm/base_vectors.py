"""cFSM GBT base vector generation

Ported from MATLAB:
  base_column.m, base_properties.m, base_vectors.m, base_update.m,
  yDOFs.m, mode_select.m

Authors (original MATLAB): S. Adany, B. Schafer, Z. Li
"""

import numpy as np
from scipy import linalg as la
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine.properties import elemprop


def _cutwp_prop2(coord, ends):
    """Wrapper for cutwp_prop2 cross-section properties.

    Matches MATLAB signature:
        [A,xc,yc,Ix,Iy,Ixy,theta,I1,I2,J,xs,ys,Cw,B1,B2,wn] = cutwp_prop2(coord,ends)

    Args:
        coord: (nnodes, 2) -- [x, z] coordinates (0-based indexing into array)
        ends:  (nelems, 3) -- [start_node(1-based), end_node(1-based), thickness]

    Returns:
        A, xc, yc, Ix, Iy, Ixy, theta, I1, I2, J, xs, ys, Cw, B1, B2, wn
        where wn is the warping function array (nnodes,)
    """
    nele = ends.shape[0]
    nnode_total = coord.shape[0]

    # Classify section type: count 2-element joints
    # Build adjacency
    node_list = []
    for i in range(nele):
        node_list.append(int(ends[i, 0]))
        node_list.append(int(ends[i, 1]))

    unique_nodes = set(node_list)
    nnode = len(unique_nodes)
    j_count = 0  # number of 2-element joints
    for n in unique_nodes:
        cnt = node_list.count(n)
        if cnt == 2:
            j_count += 1

    if j_count == nele:
        section = 'close'
    elif j_count == nele - 1:
        section = 'open'
    else:
        section = 'open'  # multi-branched treated as open

    # Element properties
    t = np.zeros(nele)
    xm = np.zeros(nele)
    ym = np.zeros(nele)
    xd = np.zeros(nele)
    yd = np.zeros(nele)
    L = np.zeros(nele)

    for i in range(nele):
        sn = int(ends[i, 0]) - 1  # 0-based
        fn = int(ends[i, 1]) - 1
        t[i] = ends[i, 2]
        xm[i] = (coord[sn, 0] + coord[fn, 0]) / 2
        ym[i] = (coord[sn, 1] + coord[fn, 1]) / 2
        xd[i] = coord[fn, 0] - coord[sn, 0]
        yd[i] = coord[fn, 1] - coord[sn, 1]
        L[i] = math.sqrt(xd[i]**2 + yd[i]**2)

    # Cross section area
    A = np.sum(L * t)

    # Centroid
    if A > 1e-20:
        xc = np.sum(L * t * xm) / A
        yc = np.sum(L * t * ym) / A
    else:
        xc = 0.0
        yc = 0.0

    sqrtA = math.sqrt(abs(A)) if A > 0 else 1.0
    if abs(xc / sqrtA) < 1e-12:
        xc = 0.0
    if abs(yc / sqrtA) < 1e-12:
        yc = 0.0

    # Moments of inertia
    Ix = np.sum((yd**2 / 12 + (ym - yc)**2) * L * t)
    Iy = np.sum((xd**2 / 12 + (xm - xc)**2) * L * t)
    Ixy = np.sum((xd * yd / 12 + (xm - xc) * (ym - yc)) * L * t)

    if A > 0 and abs(Ixy / A**2) < 1e-12:
        Ixy = 0.0

    # Principal axis angle (using complex angle like MATLAB)
    theta = np.angle(complex(Ix - Iy, -2 * Ixy)) / 2

    # Transform to centroid principal coordinates
    rot = np.array([[math.cos(theta), math.sin(theta)],
                    [-math.sin(theta), math.cos(theta)]])
    coord12 = np.zeros_like(coord)
    for i in range(nnode_total):
        coord12[i, :] = rot @ np.array([coord[i, 0] - xc, coord[i, 1] - yc])

    # Recompute element properties in principal coordinates
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        xm[i] = (coord12[sn, 0] + coord12[fn, 0]) / 2
        ym[i] = (coord12[sn, 1] + coord12[fn, 1]) / 2
        xd[i] = coord12[fn, 0] - coord12[sn, 0]
        yd[i] = coord12[fn, 1] - coord12[sn, 1]

    # Principal moments of inertia
    I1 = np.sum((yd**2 / 12 + ym**2) * L * t)
    I2 = np.sum((xd**2 / 12 + xm**2) * L * t)

    if section == 'close':
        # Closed section
        p = np.zeros(nele)
        for i in range(nele):
            sn = int(ends[i, 0]) - 1
            fn = int(ends[i, 1]) - 1
            p[i] = ((coord[sn, 0] - xc) * (coord[fn, 1] - yc) -
                     (coord[fn, 0] - xc) * (coord[sn, 1] - yc)) / L[i]
        J = 4 * np.sum(p * L / 2)**2 / np.sum(L / t)
        xs = np.nan; ys = np.nan; Cw = np.nan
        B1_val = np.nan; B2_val = np.nan
        wn = np.full(nnode_total, np.nan)
        return A, xc, yc, Ix, Iy, Ixy, theta, I1, I2, J, xs, ys, Cw, B1_val, B2_val, wn

    # Open section
    J = np.sum(L * t**3) / 3

    # Shear center calculation
    w = np.zeros((nnode_total, 2))   # col0: visited flag (node# 1-based), col1: warping
    w[int(ends[0, 0]) - 1, 0] = ends[0, 0]  # mark first start node as visited

    Iwx = 0.0
    Iwy = 0.0

    # Build element list we can iterate through
    ends_work = ends.copy()
    for j_iter in range(nele):
        # Find next processable element
        found = False
        for i in range(nele):
            sn_1b = int(ends_work[i, 0])
            fn_1b = int(ends_work[i, 1])
            if sn_1b == 0 and fn_1b == 0:
                continue
            sn_visited = w[sn_1b - 1, 0] != 0
            fn_visited = w[fn_1b - 1, 0] != 0
            if (sn_visited and fn_visited) or (not sn_visited and not fn_visited):
                continue
            # One end visited, one not
            found = True
            break
        if not found:
            # Try to find any unprocessed element with at least one end visited
            for i in range(nele):
                sn_1b = int(ends_work[i, 0])
                fn_1b = int(ends_work[i, 1])
                if sn_1b == 0 and fn_1b == 0:
                    continue
                found = True
                break
            if not found:
                break

        sn_1b = int(ends_work[i, 0])
        fn_1b = int(ends_work[i, 1])
        sn = sn_1b - 1
        fn = fn_1b - 1
        p = ((coord[sn, 0] - xc) * (coord[fn, 1] - yc) -
             (coord[fn, 0] - xc) * (coord[sn, 1] - yc)) / L[i]

        if w[sn, 0] == 0:
            w[sn, 0] = sn_1b
            w[sn, 1] = w[fn, 1] - p * L[i]
        elif w[fn, 0] == 0:
            w[fn, 0] = fn_1b
            w[fn, 1] = w[sn, 1] + p * L[i]

        Iwx += (1/3 * (w[sn, 1] * (coord[sn, 0] - xc) + w[fn, 1] * (coord[fn, 0] - xc)) +
                1/6 * (w[sn, 1] * (coord[fn, 0] - xc) + w[fn, 1] * (coord[sn, 0] - xc))) * t[i] * L[i]
        Iwy += (1/3 * (w[sn, 1] * (coord[sn, 1] - yc) + w[fn, 1] * (coord[fn, 1] - yc)) +
                1/6 * (w[sn, 1] * (coord[fn, 1] - yc) + w[fn, 1] * (coord[sn, 1] - yc))) * t[i] * L[i]

        # Mark element as processed
        ends_work[i, 0] = 0
        ends_work[i, 1] = 0

    denom = Ix * Iy - Ixy**2
    if abs(denom) > 1e-20:
        xs = (Iy * Iwy - Ixy * Iwx) / denom + xc
        ys = -(Ix * Iwx - Ixy * Iwy) / denom + yc
    else:
        xs = xc
        ys = yc

    if abs(xs / sqrtA) < 1e-12:
        xs = 0.0
    if abs(ys / sqrtA) < 1e-12:
        ys = 0.0

    # Unit warping (with respect to shear center)
    wo = np.zeros((nnode_total, 2))
    wo[int(ends[0, 0]) - 1, 0] = ends[0, 0]
    wno = 0.0
    Cw = 0.0

    ends_work2 = ends.copy()
    for j_iter in range(nele):
        found = False
        for i in range(nele):
            sn_1b = int(ends_work2[i, 0])
            fn_1b = int(ends_work2[i, 1])
            if sn_1b == 0 and fn_1b == 0:
                continue
            sn_visited = wo[sn_1b - 1, 0] != 0
            fn_visited = wo[fn_1b - 1, 0] != 0
            if (sn_visited and fn_visited) or (not sn_visited and not fn_visited):
                continue
            found = True
            break
        if not found:
            for i in range(nele):
                sn_1b = int(ends_work2[i, 0])
                fn_1b = int(ends_work2[i, 1])
                if sn_1b == 0 and fn_1b == 0:
                    continue
                found = True
                break
            if not found:
                break

        sn_1b = int(ends_work2[i, 0])
        fn_1b = int(ends_work2[i, 1])
        sn = sn_1b - 1
        fn = fn_1b - 1
        po = ((coord[sn, 0] - xs) * (coord[fn, 1] - ys) -
              (coord[fn, 0] - xs) * (coord[sn, 1] - ys)) / L[i]

        if wo[sn, 0] == 0:
            wo[sn, 0] = sn_1b
            wo[sn, 1] = wo[fn, 1] - po * L[i]
        elif wo[fn, 0] == 0:
            wo[fn, 0] = fn_1b
            wo[fn, 1] = wo[sn, 1] + po * L[i]

        wno += 1 / (2 * A) * (wo[sn, 1] + wo[fn, 1]) * t[i] * L[i]
        ends_work2[i, 0] = 0
        ends_work2[i, 1] = 0

    wn = wno - wo[:, 1]

    # Warping constant
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        Cw += 1/3 * (wn[sn]**2 + wn[sn] * wn[fn] + wn[fn]**2) * t[i] * L[i]

    # Shear center in principal coordinates
    s12 = rot @ np.array([xs - xc, ys - yc])
    ro = math.sqrt((I1 + I2) / A + s12[0]**2 + s12[1]**2)

    # B1 and B2
    B1_val = 0.0
    B2_val = 0.0
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        x1 = coord12[sn, 0]; y1 = coord12[sn, 1]
        x2 = coord12[fn, 0]; y2 = coord12[fn, 1]
        B1_val += ((y1 + y2) * (y1**2 + y2**2) / 4 +
                   (y1 * (2 * x1**2 + (x1 + x2)**2) + y2 * (2 * x2**2 + (x1 + x2)**2)) / 12) * L[i] * t[i]
        B2_val += ((x1 + x2) * (x1**2 + x2**2) / 4 +
                   (x1 * (2 * y1**2 + (y1 + y2)**2) + x2 * (2 * y2**2 + (y1 + y2)**2)) / 12) * L[i] * t[i]
    if abs(I1) > 1e-20:
        B1_val = B1_val / I1 - 2 * s12[1]
    if abs(I2) > 1e-20:
        B2_val = B2_val / I2 - 2 * s12[0]

    if abs(B1_val / sqrtA) < 1e-12:
        B1_val = 0.0
    if abs(B2_val / sqrtA) < 1e-12:
        B2_val = 0.0

    return A, xc, yc, Ix, Iy, Ixy, theta, I1, I2, J, xs, ys, Cw, B1_val, B2_val, wn


def yDOFs(node, elem, m_node, nmno, ndm, Ryd, Rud):
    """Create y-DOFs of main nodes for global and distortional buckling.

    Ported from yDOFs.m

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5)
        m_node: main nodes array
        nmno: number of main nodes
        ndm: number of distortional modes
        Ryd: distortional constraint matrix
        Rud: undefinite node constraint matrix

    Returns:
        dy: (nmno, ngm+ndm) y-DOFs matrix
        ngm: number of global modes
    """
    # Cross-section properties via cutwp_prop2
    # coord = node[:,1:3] (x,z coordinates, 0-based indexing)
    # ends = elem[:,1:4] (nodei, nodej, thickness - 1-based node numbers)
    coord = node[:, 1:3].copy()  # (nnodes, 2)
    ends = elem[:, 1:4].copy()   # (nelems, 3) -- [nodei(1b), nodej(1b), t]

    (A, xcg, zcg, Ix, Iy, Ixy, thetap, I1, I2, J,
     xs, ys, Cw, B1, B2, w) = _cutwp_prop2(coord, ends)

    # Coordinate transformation to principal axes
    th = thetap
    rot = np.array([[math.cos(th), -math.sin(th)],
                    [math.sin(th),  math.cos(th)]])
    CG = rot @ np.array([xcg, zcg])

    # Create y-DOFs for global buckling
    dy = np.zeros((nmno, 4))
    for i in range(nmno):
        orig_node = int(m_node[i, 3])  # 1-based original node number
        XZi = rot @ np.array([m_node[i, 1], m_node[i, 2]])
        dy[i, 0] = 1.0                  # axial
        dy[i, 1] = XZi[1] - CG[1]      # bending about 1-axis
        dy[i, 2] = XZi[0] - CG[0]      # bending about 2-axis
        dy[i, 3] = w[orig_node - 1]     # warping

    # Count existing global modes (eliminate zero columns)
    ngm = 4
    ind = np.ones(4, dtype=int)
    for i in range(4):
        if np.max(np.abs(dy[:, i])) < 1e-15:
            ind[i] = 0
            ngm -= 1

    # Eliminate zero columns
    sdy = dy.copy()
    dy_new = np.zeros((nmno, ngm))
    k = 0
    for i in range(4):
        if ind[i] == 1:
            dy_new[:, k] = sdy[:, i]
            k += 1
    dy = dy_new

    # Create y-DOFs for distortional buckling
    if ndm > 0:
        # Cholesky decomposition of Ryd
        try:
            ch = la.cholesky(Ryd, lower=False)  # upper triangular
        except la.LinAlgError:
            # If Ryd is not positive definite, use regularization
            eigvals = np.linalg.eigvalsh(Ryd)
            min_eig = min(eigvals)
            if min_eig <= 0:
                Ryd_reg = Ryd + (-min_eig + 1e-10) * np.eye(nmno)
                ch = la.cholesky(Ryd_reg, lower=False)
            else:
                ch = la.cholesky(Ryd, lower=False)

        # null space of (ch * dy_global)'
        junk = la.null_space((ch @ dy[:, :ngm]).T)
        # junk2 = ch \ junk
        junk2 = la.solve_triangular(ch, junk, lower=False)

        jjunk1 = la.null_space(junk2.T)
        jjunk2 = la.null_space(Rud.T)

        nj1 = jjunk1.shape[1] if jjunk1.ndim > 1 else 0
        nj2 = jjunk2.shape[1] if jjunk2.ndim > 1 else 0

        if nj1 > 0 and nj2 > 0:
            jjunk3 = np.hstack([jjunk1, jjunk2])
        elif nj1 > 0:
            jjunk3 = jjunk1
        elif nj2 > 0:
            jjunk3 = jjunk2
        else:
            jjunk3 = np.zeros((nmno, 0))

        jjunk4 = la.null_space(jjunk3.T)

        if jjunk4.shape[1] >= ndm:
            junk3 = jjunk4.T @ Ryd @ jjunk4
            try:
                eigvals, V = la.eigh(junk3)
            except la.LinAlgError:
                eigvals, V = np.linalg.eigh(junk3)

            # Append distortional DOFs
            dy_dist = jjunk4 @ V
            # Take only ndm columns
            if dy_dist.shape[1] >= ndm:
                dy = np.hstack([dy, dy_dist[:, :ndm]])
            else:
                dy = np.hstack([dy, dy_dist])
        else:
            # Not enough vectors - pad with zeros
            if jjunk4.shape[1] > 0:
                junk3 = jjunk4.T @ Ryd @ jjunk4
                eigvals, V = la.eigh(junk3)
                dy_dist = jjunk4 @ V
                dy = np.hstack([dy, dy_dist])
            remaining = ndm - (dy.shape[1] - ngm)
            if remaining > 0:
                dy = np.hstack([dy, np.zeros((nmno, remaining))])

    return dy, ngm


def base_vectors(dy, elem, elprop_arr, a, m, node_prop, nmno, ncno, nsno,
                 ngm, ndm, nlm, Rx, Rz, Rp, Rys, DOFperm):
    """Create base vectors for single half-wave number m.

    Ported from base_vectors.m

    Args:
        dy: (nmno, ngm+ndm) y-DOFs
        elem: (nelems, 5)
        elprop_arr: (nelems, 3) element properties
        a: member length
        m: half-wave number
        node_prop: (nnodes, 4)
        nmno, ncno, nsno, ngm, ndm, nlm: mode counts
        Rx, Rz, Rp, Rys: constraint matrices
        DOFperm: DOF permutation matrix

    Returns:
        b_v_m: (ndof, ndof) base vectors matrix
    """
    km = m * math.pi / a
    nno = node_prop.shape[0]
    ndof = 4 * nno
    neno = nmno - ncno
    nel = elem.shape[0]

    b_v_m = np.zeros((ndof, ndof))

    ngdm = ngm + ndm

    # ---------------------------------------------------------------
    # GLOBAL AND DISTORTIONAL MODES
    # ---------------------------------------------------------------
    # Add y DOFs of main nodes
    b_v_m[:nmno, :ngdm] = dy[:, :ngdm]

    # Add x DOFs of corner nodes
    b_v_m[nmno:nmno + ncno, :ngdm] = Rx @ b_v_m[:nmno, :ngdm]

    # Add z DOFs of corner nodes
    b_v_m[nmno + ncno:nmno + 2 * ncno, :ngdm] = Rz @ b_v_m[:nmno, :ngdm]

    # Add other planar DOFs
    if Rp.shape[0] > 0:
        b_v_m[nmno + 2 * ncno:ndof - nsno, :ngdm] = Rp @ b_v_m[nmno:nmno + 2 * ncno, :ngdm]

    # Add y DOFs of sub-nodes
    if nsno > 0:
        b_v_m[ndof - nsno:ndof, :ngdm] = Rys @ b_v_m[:nmno, :ngdm]

    # Division by km
    if abs(km) > 1e-15:
        b_v_m[nmno:ndof - nsno, :ngdm] /= km

    # Normalize base vectors
    for i in range(ngdm):
        norm_val = np.linalg.norm(b_v_m[:, i])
        if norm_val > 1e-15:
            b_v_m[:, i] /= norm_val

    # ---------------------------------------------------------------
    # LOCAL MODES
    # ---------------------------------------------------------------
    b_v_m[:ndof, ngdm:ngdm + nlm] = 0.0

    # Rotation DOFs for main nodes
    if nmno > 0:
        n_rot_main = min(nmno, nlm)
        b_v_m[3 * nmno:3 * nmno + n_rot_main, ngdm:ngdm + n_rot_main] = np.eye(n_rot_main)

    # Rotation DOFs for sub-nodes
    if nsno > 0 and nmno + nsno <= nlm:
        b_v_m[4 * nmno + 2 * nsno:4 * nmno + 3 * nsno,
              ngdm + nmno:ngdm + nmno + nsno] = np.eye(nsno)

    # x,z DOFs for edge nodes
    k = 0
    for i in range(nno):
        if int(node_prop[i, 3]) == 2:
            col_idx = ngdm + nmno + nsno + k

            # Find adjacent element for this edge node
            orig_node_1b = int(node_prop[i, 0])  # original 1-based
            el_found = []
            for e in range(nel):
                ni_1b = int(elem[e, 1])
                nj_1b = int(elem[e, 2])
                if ni_1b == orig_node_1b or nj_1b == orig_node_1b:
                    el_found.append(e)

            if len(el_found) > 0:
                alfa = elprop_arr[el_found[0], 2]
                # x DOF row for this edge node: nmno + 2*ncno + k
                # z DOF row: nmno + 2*ncno + neno + k
                x_row = nmno + 2 * ncno + k
                z_row = nmno + 2 * ncno + neno + k
                if x_row < ndof and col_idx < ndof:
                    b_v_m[x_row, col_idx] = -math.sin(alfa)
                if z_row < ndof and col_idx < ndof:
                    b_v_m[z_row, col_idx] = math.cos(alfa)
            k += 1

    # x,z DOFs for sub-nodes
    if nsno > 0:
        k = 0
        for i in range(nno):
            if int(node_prop[i, 3]) == 3:
                col_idx = ngdm + nmno + nsno + neno + k
                if col_idx < ndof:
                    orig_node_1b = int(node_prop[i, 0])
                    el_found = []
                    for e in range(nel):
                        ni_1b = int(elem[e, 1])
                        nj_1b = int(elem[e, 2])
                        if ni_1b == orig_node_1b or nj_1b == orig_node_1b:
                            el_found.append(e)
                    if len(el_found) > 0:
                        alfa = elprop_arr[el_found[0], 2]
                        x_row = 4 * nmno + k
                        z_row = 4 * nmno + nsno + k
                        if x_row < ndof and col_idx < ndof:
                            b_v_m[x_row, col_idx] = -math.sin(alfa)
                        if z_row < ndof and col_idx < ndof:
                            b_v_m[z_row, col_idx] = math.cos(alfa)
                k += 1

    # ---------------------------------------------------------------
    # OTHER MODES
    # ---------------------------------------------------------------
    nom = ndof - ngdm - nlm
    b_v_m[:ndof, ngdm + nlm:ngdm + nlm + 2 * nel] = 0.0

    for i in range(nel):
        alfa = elprop_arr[i, 2]
        # Node indices (1-based, as in MATLAB) -- these are ORIGINAL node numbers
        # In MATLAB code: nnod1=elem(i,2), nnod2=elem(i,3)
        # But in base_vectors.m, after node renumbering via node_prop, the elem still
        # uses original node numbers. However, the DOF indexing in base_vectors uses
        # the node's position in 1:nno order (which IS the original ordering).
        # The MATLAB uses: b_v_m((nnod1-1)*2+2, ...) which maps node 1-based to
        # y-DOF in the ORIGINAL ordering (before DOFperm).
        # In the re-ordered basis, position (nnod1-1)*2+2 is the y-DOF of nnod1.
        # But wait -- the new ordering puts y_main first, then x_corner, etc.
        # The "(nnod1-1)*2+2" pattern matches the ORIGINAL DOF ordering:
        # [u1,v1,u2,v2,...] so (nnod1-1)*2+1 = u, (nnod1-1)*2+2 = v (1-based)
        # In 0-based: (nnod1-1)*2 = u, (nnod1-1)*2+1 = v

        nnod1 = int(elem[i, 1])  # 1-based
        nnod2 = int(elem[i, 2])  # 1-based

        # Shear modes: y-DOF entries
        # MATLAB: b_v_m((nnod1-1)*2+2, col) = 0.5
        # 1-based index (nnod1-1)*2+2 => 0-based: (nnod1-1)*2+1
        y_row1 = (nnod1 - 1) * 2 + 1
        y_row2 = (nnod2 - 1) * 2 + 1
        shear_col = ngdm + nlm + i
        if shear_col < ndof:
            if y_row1 < ndof:
                b_v_m[y_row1, shear_col] = 0.5
            if y_row2 < ndof:
                b_v_m[y_row2, shear_col] = -0.5

        # Transverse modes: x,z DOF entries
        trans_col = ngdm + nlm + nel + i
        if trans_col < ndof:
            # x DOFs: (nnod-1)*2+1 in MATLAB 1-based => (nnod-1)*2 in 0-based
            x_row1 = (nnod1 - 1) * 2
            x_row2 = (nnod2 - 1) * 2
            # z DOFs: 2*nno + (nnod-1)*2+1 in MATLAB 1-based => 2*nno + (nnod-1)*2 in 0-based
            z_row1 = 2 * nno + (nnod1 - 1) * 2
            z_row2 = 2 * nno + (nnod2 - 1) * 2

            if x_row1 < ndof:
                b_v_m[x_row1, trans_col] = -0.5 * math.cos(alfa)
            if x_row2 < ndof:
                b_v_m[x_row2, trans_col] = 0.5 * math.cos(alfa)
            if z_row1 < ndof:
                b_v_m[z_row1, trans_col] = 0.5 * math.sin(alfa)
            if z_row2 < ndof:
                b_v_m[z_row2, trans_col] = -0.5 * math.sin(alfa)

    # ---------------------------------------------------------------
    # RE-ORDER DOFs
    # ---------------------------------------------------------------
    b_v_m[:, :ngdm + nlm] = DOFperm @ b_v_m[:, :ngdm + nlm]

    return b_v_m


def base_column(node, elem, prop, a, BC, m_a):
    """Create base vectors for a column with length a.

    Ported from base_column.m

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5)
        prop: (nmats, 6)
        a: member length
        BC: boundary condition string
        m_a: array of longitudinal terms (half-wave numbers)

    Returns:
        b_v_l: block diagonal base vectors
        ngm, ndm, nlm: mode counts
    """
    from .node_utils import base_properties
    from .constraints import mode_constr

    # Set stress to 1.0 for axial modes
    node_work = node.copy()
    node_work[:, 7] = 1.0

    # Get base properties
    (elprop_arr, m_node, m_elem, node_prop,
     nmno, ncno, nsno, ndm, nlm, DOFperm) = base_properties(node_work, elem)

    nnodes = node_work.shape[0]
    ndof_m = 4 * nnodes
    totalm = len(m_a)

    b_v_l = np.zeros((ndof_m * totalm, ndof_m * totalm))

    for ml in range(totalm):
        # Create constraint matrices
        Rx, Rz, Rp, Ryd, Rys, Rud = mode_constr(
            node_work, elem, prop, node_prop, m_node, m_elem,
            DOFperm, m_a[ml], a, BC
        )

        # Create y DOFs
        dy, ngm = yDOFs(node_work, elem, m_node, nmno, ndm, Ryd, Rud)

        # Create base vectors for this m
        b_v_m = base_vectors(
            dy, elem, elprop_arr, a, m_a[ml], node_prop,
            nmno, ncno, nsno, ngm, ndm, nlm, Rx, Rz, Rp, Rys, DOFperm
        )

        # Place in block diagonal
        r0 = ndof_m * ml
        r1 = ndof_m * (ml + 1)
        b_v_l[r0:r1, r0:r1] = b_v_m

    return b_v_l, ngm, ndm, nlm


def base_update(ospace, normal, b_v_l, a, m_a, node, elem, prop,
                ngm, ndm, nlm, BC, couple, orth):
    """Orthogonalize and normalize base vectors.

    Ported from base_update.m

    Args:
        ospace: O-space option (1-4)
        normal: normalization option (0-3)
        b_v_l: natural base vectors
        a: member length
        m_a: longitudinal terms
        node, elem, prop: model data
        ngm, ndm, nlm: mode counts
        BC: boundary condition string
        couple: 1=uncoupled, 2=coupled
        orth: 1=natural, 2=modal(axial), 3=modal(load)

    Returns:
        b_v: updated base vectors
    """
    from .stiffness import create_Ks

    nnodes = node.shape[0]
    ndof_m = 4 * nnodes
    totalm = len(m_a)
    b_v = np.zeros((ndof_m * totalm, ndof_m * totalm))

    if couple == 1:
        # Uncoupled basis
        for ml in range(totalm):
            r0 = ndof_m * ml
            r1 = ndof_m * (ml + 1)
            b_v_m = b_v_l[r0:r1, r0:r1].copy()

            # Create K/Kg if needed
            K = None
            Kg = None
            if normal in (2, 3) or ospace in (2, 3) or orth in (2, 3):
                nelems = elem.shape[0]
                elprop_arr = elemprop(node, elem)
                node_work = node.copy()
                if orth in (1, 2):
                    node_work[:, 7] = 1.0  # axial stress
                K, Kg = create_Ks(m_a[ml], node_work, elem, elprop_arr, prop, a, BC)

            if orth in (2, 3) or ospace in (2, 3, 4):
                # Build dof index
                dofindex = np.zeros((5 if ospace == 1 else 4, 2), dtype=int)
                dofindex[0] = [0, ngm - 1]
                dofindex[1] = [ngm, ngm + ndm - 1]
                dofindex[2] = [ngm + ndm, ngm + ndm + nlm - 1]
                if ospace == 1:
                    dofindex[3] = [ngm + ndm + nlm, ngm + ndm + nlm + nnodes - 2]
                    dofindex[4] = [ngm + ndm + nlm + nnodes - 1, ndof_m - 1]
                else:
                    dofindex[3] = [ngm + ndm + nlm, ndof_m - 1]

                # Define O-space vectors
                if ospace in (2, 3, 4):
                    gdl_end = dofindex[2, 1] + 1
                    o_start = dofindex[3, 0]
                    o_end = dofindex[3, 1] + 1
                    gdl_block = b_v_m[:, :gdl_end]
                    A_null = la.null_space(gdl_block.T)
                    if A_null.shape[1] > 0:
                        n_other = o_end - o_start
                        if ospace == 2 and K is not None:
                            try:
                                b_v_m[:, o_start:o_end] = np.linalg.solve(K, A_null[:, :n_other])
                            except np.linalg.LinAlgError:
                                b_v_m[:, o_start:o_end] = A_null[:, :n_other]
                        elif ospace == 3 and Kg is not None:
                            try:
                                b_v_m[:, o_start:o_end] = np.linalg.solve(Kg, A_null[:, :n_other])
                            except np.linalg.LinAlgError:
                                b_v_m[:, o_start:o_end] = A_null[:, :n_other]
                        elif ospace == 4:
                            b_v_m[:, o_start:o_end] = A_null[:, :n_other]

                # Orthogonalization via eigenvalue problem
                if K is not None and Kg is not None:
                    for isub in range(len(dofindex)):
                        di0 = dofindex[isub, 0]
                        di1 = dofindex[isub, 1]
                        if di1 >= di0:
                            cols = slice(di0, di1 + 1)
                            Bsub = b_v_m[:, cols]
                            Ksub = Bsub.T @ K @ Bsub
                            Kgsub = Bsub.T @ Kg @ Bsub
                            try:
                                eigvals, V = la.eigh(Ksub, Kgsub)
                            except la.LinAlgError:
                                try:
                                    eigvals, V = la.eig(Ksub, Kgsub)
                                    eigvals = np.real(eigvals)
                                    V = np.real(V)
                                except:
                                    continue

                            idx_sort = np.argsort(np.real(eigvals))
                            V = np.real(V[:, idx_sort])

                            if normal in (2, 3):
                                if normal == 2:
                                    s = np.diag(V.T @ Ksub @ V)
                                else:
                                    s = np.diag(V.T @ Kgsub @ V)
                                s = np.sqrt(np.abs(s))
                                for ii in range(V.shape[1]):
                                    if abs(s[ii]) > 1e-15:
                                        V[:, ii] /= s[ii]

                            b_v_m[:, cols] = Bsub @ V

            # Normalization for ospace==1
            if normal in (2, 3) and ospace == 1 and K is not None and Kg is not None:
                for ii in range(ndof_m):
                    if normal == 2:
                        val = b_v_m[:, ii].T @ K @ b_v_m[:, ii]
                    else:
                        val = b_v_m[:, ii].T @ Kg @ b_v_m[:, ii]
                    if abs(val) > 1e-15:
                        b_v_m[:, ii] /= math.sqrt(abs(val))

            # Vector norm normalization
            if normal == 1:
                for ii in range(ndof_m):
                    nrm = np.linalg.norm(b_v_m[:, ii])
                    if nrm > 1e-15:
                        b_v_m[:, ii] /= nrm

            b_v[r0:r1, r0:r1] = b_v_m

    else:
        # Coupled basis
        K = None
        Kg = None
        if normal in (2, 3) or ospace in (2, 3) or orth in (2, 3):
            nelems = elem.shape[0]
            elprop_arr = elemprop(node, elem)
            node_work = node.copy()
            if orth in (1, 2):
                node_work[:, 7] = 1.0

            # Build full multi-m stiffness matrices
            # This uses the main program's klocal/kglocal/trans/assemble
            # which handle multiple m terms. For the single-m functions we have,
            # we build block-diagonal K, Kg.
            K = np.zeros((4 * nnodes * totalm, 4 * nnodes * totalm))
            Kg = np.zeros((4 * nnodes * totalm, 4 * nnodes * totalm))

            for ml in range(totalm):
                K_m, Kg_m = create_Ks(m_a[ml], node_work, elem, elprop_arr, prop, a, BC)
                r0 = ndof_m * ml
                r1 = ndof_m * (ml + 1)
                K[r0:r1, r0:r1] = K_m
                Kg[r0:r1, r0:r1] = Kg_m

        if orth in (2, 3) or ospace in (2, 3, 4):
            dofindex = np.zeros((4, 2), dtype=int)
            dofindex[0] = [0, ngm - 1]
            dofindex[1] = [ngm, ngm + ndm - 1]
            dofindex[2] = [ngm + ndm, ngm + ndm + nlm - 1]
            dofindex[3] = [ngm + ndm + nlm, ndof_m - 1]

            nom = ndof_m - (ngm + ndm + nlm)

            # Collect sub-space vectors
            b_v_GDL = np.zeros((ndof_m * totalm, (ngm + ndm + nlm) * totalm))
            b_v_G = np.zeros((ndof_m * totalm, ngm * totalm))
            b_v_D = np.zeros((ndof_m * totalm, ndm * totalm))
            b_v_L = np.zeros((ndof_m * totalm, nlm * totalm))
            b_v_O = np.zeros((ndof_m * totalm, nom * totalm))

            for ml in range(totalm):
                r0 = ndof_m * ml
                b_v_m_block = b_v_l[:, r0:r0 + ndof_m]
                gdl_n = ngm + ndm + nlm
                b_v_GDL[:, ml * gdl_n:(ml + 1) * gdl_n] = b_v_m_block[:, :gdl_n]
                b_v_G[:, ml * ngm:(ml + 1) * ngm] = b_v_m_block[:, dofindex[0, 0]:dofindex[0, 1] + 1]
                b_v_D[:, ml * ndm:(ml + 1) * ndm] = b_v_m_block[:, dofindex[1, 0]:dofindex[1, 1] + 1]
                b_v_L[:, ml * nlm:(ml + 1) * nlm] = b_v_m_block[:, dofindex[2, 0]:dofindex[2, 1] + 1]
                b_v_O[:, ml * nom:(ml + 1) * nom] = b_v_m_block[:, dofindex[3, 0]:dofindex[3, 1] + 1]

            # Define O-space
            if ospace == 3 and K is not None:
                A_null = la.null_space(b_v_GDL.T)
                try:
                    b_v_O = np.linalg.solve(K, A_null)
                except:
                    b_v_O = A_null
                for ml in range(totalm):
                    b_v[ml * ndof_m + dofindex[3, 0]:ml * ndof_m + dofindex[3, 1] + 1,
                        :] = b_v_O[ml * ndof_m:(ml + 1) * ndof_m, ml * nom:(ml + 1) * nom].T
            elif ospace == 4 and Kg is not None:
                A_null = la.null_space(b_v_GDL.T)
                try:
                    b_v_O = np.linalg.solve(Kg, A_null)
                except:
                    b_v_O = A_null
            elif ospace == 5:
                A_null = la.null_space(b_v_GDL.T)
                b_v_O = A_null

            # Orthogonalization
            if K is not None and Kg is not None:
                sub_vectors = [b_v_G, b_v_D, b_v_L, b_v_O]
                sub_sizes = [ngm, ndm, nlm, nom]

                for isub in range(4):
                    di0 = dofindex[isub, 0]
                    di1 = dofindex[isub, 1]
                    if di1 >= di0:
                        Bsub = sub_vectors[isub]
                        Ksub = Bsub.T @ K @ Bsub
                        Kgsub = Bsub.T @ Kg @ Bsub
                        try:
                            eigvals, V = la.eigh(Ksub, Kgsub)
                        except la.LinAlgError:
                            try:
                                eigvals, V = la.eig(Ksub, Kgsub)
                                eigvals = np.real(eigvals)
                                V = np.real(V)
                            except:
                                V = np.eye(Bsub.shape[1])
                                eigvals = np.ones(Bsub.shape[1])

                        idx_sort = np.argsort(np.real(eigvals))
                        V = np.real(V[:, idx_sort])

                        if normal in (2, 3):
                            if normal == 2:
                                s = np.diag(V.T @ Ksub @ V)
                            else:
                                s = np.diag(V.T @ Kgsub @ V)
                            s = np.sqrt(np.abs(s))
                            n_cols = sub_sizes[isub] * totalm
                            for ii in range(min(V.shape[1], n_cols)):
                                if abs(s[ii]) > 1e-15:
                                    V[:, ii] /= s[ii]

                        b_v_orth = Bsub @ V
                        ns = sub_sizes[isub]
                        for ml in range(totalm):
                            c0 = ml * ndof_m + di0
                            c1 = ml * ndof_m + di1 + 1
                            b_v[:, c0:c1] = b_v_orth[:, ml * ns:(ml + 1) * ns]

        # Normalization for ospace==1
        if normal in (2, 3) and ospace == 1 and K is not None and Kg is not None:
            for ii in range(ndof_m * totalm):
                if normal == 2:
                    val = b_v[:, ii].T @ K @ b_v[:, ii]
                else:
                    val = b_v[:, ii].T @ Kg @ b_v[:, ii]
                if abs(val) > 1e-15:
                    b_v[:, ii] /= math.sqrt(abs(val))

        # Vector norm normalization
        if normal == 1:
            for ii in range(ndof_m * totalm):
                nrm = np.linalg.norm(b_v[:, ii])
                if nrm > 1e-15:
                    b_v[:, ii] /= nrm

    return b_v


def mode_select(b_v, ngm, ndm, nlm, if_g, if_d, if_l, if_o, ndof_m, m_a):
    """Select required base vectors for mode decomposition.

    Ported from mode_select.m

    Args:
        b_v: base vectors
        ngm, ndm, nlm: mode counts
        if_g: (ngm,) selection for global modes (1=selected, 0=eliminated)
        if_d: (ndm,) selection for distortional modes
        if_l: (nlm,) selection for local modes
        if_o: (nom,) selection for other modes
        ndof_m: DOF per m-term
        m_a: longitudinal terms

    Returns:
        b_v_red: reduced base vectors
    """
    totalm = len(m_a)
    nom = ndof_m - ngm - ndm - nlm
    nmo = 0

    # Count selected modes
    for arr in [if_g, if_d, if_l, if_o]:
        nmo += int(np.sum(np.array(arr) == 1))

    if nmo == 0:
        return np.zeros((b_v.shape[0], 0))

    b_v_red = np.zeros((b_v.shape[0], nmo * totalm))

    for ml in range(totalm):
        col_out = 0
        base_col = ndof_m * ml

        for i in range(ngm):
            if if_g[i] == 1:
                b_v_red[:, nmo * ml + col_out] = b_v[:, base_col + i]
                col_out += 1

        for i in range(ndm):
            if if_d[i] == 1:
                b_v_red[:, nmo * ml + col_out] = b_v[:, base_col + ngm + i]
                col_out += 1

        for i in range(nlm):
            if if_l[i] == 1:
                b_v_red[:, nmo * ml + col_out] = b_v[:, base_col + ngm + ndm + i]
                col_out += 1

        for i in range(nom):
            if i < len(if_o) and if_o[i] == 1:
                b_v_red[:, nmo * ml + col_out] = b_v[:, base_col + ngm + ndm + nlm + i]
                col_out += 1

    return b_v_red
