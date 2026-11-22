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

    topo = _cutwp_topology(coord, ends)

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

    # Torsion constant. A cell carries the Bredt shear flow, J = 4*Ae^2/sum(L/t)
    # (MATLAB cutwp_prop2.m after its element re-ordering block); open branches
    # attached to the cell add their own b*t^3/3.
    cell = topo['cycle_elems']
    if cell:
        on_cell = np.zeros(nele, dtype=bool)
        on_cell[cell] = True
        J = (4 * topo['cell_area']**2 / np.sum(L[on_cell] / t[on_cell])
             + np.sum(L[~on_cell] * t[~on_cell]**3) / 3)
    else:
        J = np.sum(L * t**3) / 3

    # Shear center from the sectorial products of the Saint-Venant warping function
    # about the centroid. Along a cell the warping carries the Bredt circulation
    # term, so the same formulas give the shear center of closed and cell-plus-branch
    # sections (Trefftz definition) -- MATLAB returns NaN there.
    w = _sectorial(coord, ends, L, t, topo, xc, yc)
    Iwx = 0.0
    Iwy = 0.0
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        Iwx += (1/3 * (w[sn] * (coord[sn, 0] - xc) + w[fn] * (coord[fn, 0] - xc)) +
                1/6 * (w[sn] * (coord[fn, 0] - xc) + w[fn] * (coord[sn, 0] - xc))) * t[i] * L[i]
        Iwy += (1/3 * (w[sn] * (coord[sn, 1] - yc) + w[fn] * (coord[fn, 1] - yc)) +
                1/6 * (w[sn] * (coord[fn, 1] - yc) + w[fn] * (coord[sn, 1] - yc))) * t[i] * L[i]

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
    wo = _sectorial(coord, ends, L, t, topo, xs, ys)
    wno = 0.0
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        wno += 1 / (2 * A) * (wo[sn] + wo[fn]) * t[i] * L[i]
    wn = wno - wo

    # Warping constant
    Cw = 0.0
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        Cw += 1/3 * (wn[sn]**2 + wn[sn] * wn[fn] + wn[fn]**2) * t[i] * L[i]
    if topo['cycle_elems'] and abs(Cw) < 1e-12 * A * (Ix + Iy):
        Cw = 0.0  # round-off for doubly symmetric cells (square tube, CHS)

    # Shear center in principal coordinates
    s12 = rot @ np.array([xs - xc, ys - yc])
    # B1 and B2
    B1_val = 0.0
    B2_val = 0.0
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        x1 = coord12[sn, 0]
        y1 = coord12[sn, 1]
        x2 = coord12[fn, 0]
        y2 = coord12[fn, 1]
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


def cutwp_section_type(coord, ends):
    """'open', 'close' (single cell) or 'arbitrary' (single cell with open branches).

    Raises ValueError for disconnected models, multi-cell sections and invalid
    elements, exactly as :func:`_cutwp_prop2` does.
    """
    return _cutwp_topology(coord, ends)['section']


def _cutwp_topology(coord, ends):
    """Connectivity of the cutwp model.

    MATLAB cutwp_prop2.m counts 2-element joints and treats everything that is not
    a single cell as 'open' (its 'arbitrary' branch is commented out). That reads a
    cell with a lip as an open section (J 1/1600 of the right value) and returns
    plausible numbers for a disconnected model. The cycle structure is found
    explicitly here instead.
    """
    nele = ends.shape[0]
    nnode_total = coord.shape[0]
    if nele == 0:
        raise ValueError('cutwp: the model has no elements')

    adj = {}
    for i in range(nele):
        sn = int(ends[i, 0]) - 1
        fn = int(ends[i, 1]) - 1
        if not (0 <= sn < nnode_total and 0 <= fn < nnode_total):
            raise ValueError(
                f'cutwp: element {i + 1} references nodes {int(ends[i, 0])}-'
                f'{int(ends[i, 1])} outside 1..{nnode_total}')
        if sn == fn or math.hypot(coord[fn, 0] - coord[sn, 0],
                                  coord[fn, 1] - coord[sn, 1]) == 0.0:
            raise ValueError(f'cutwp: element {i + 1} has zero length')
        if not ends[i, 2] > 0:
            raise ValueError(
                f'cutwp: element {i + 1} has non-positive thickness {ends[i, 2]}')
        adj.setdefault(sn, []).append((fn, i))
        adj.setdefault(fn, []).append((sn, i))

    # connectivity
    start = int(ends[0, 0]) - 1
    seen = {start}
    stack = [start]
    while stack:
        u = stack.pop()
        for v, _ in adj[u]:
            if v not in seen:
                seen.add(v)
                stack.append(v)
    if len(seen) != len(adj):
        nparts = 1
        rest = set(adj) - seen
        while rest:
            stack = [rest.pop()]
            while stack:
                u = stack.pop()
                for v, _ in adj[u]:
                    if v in rest:
                        rest.discard(v)
                        stack.append(v)
            nparts += 1
        raise ValueError(
            f'cutwp: the model is disconnected ({nparts} separate parts); section '
            'properties are defined for one connected cross-section')

    ncycles = nele - len(adj) + 1
    if ncycles > 1:
        raise ValueError(
            f'cutwp: multi-cell closed sections ({ncycles} independent cells) are not '
            'supported -- J, shear center and Cw need a multi-cell shear-flow solution')

    cycle_nodes = []
    cycle_elems = []
    cell_area = 0.0
    if ncycles == 1:
        # strip open branches leaf by leaf; what remains is the cell
        deg = {u: len(v) for u, v in adj.items()}
        alive_e = np.ones(nele, dtype=bool)
        leaves = [u for u, d in deg.items() if d == 1]
        while leaves:
            u = leaves.pop()
            if deg[u] != 1:
                continue
            for v, e in adj[u]:
                if alive_e[e]:
                    alive_e[e] = False
                    deg[u] -= 1
                    deg[v] -= 1
                    if deg[v] == 1:
                        leaves.append(v)
        # walk the cell in order (by element id, so two parallel elements also work)
        e0 = int(np.flatnonzero(alive_e)[0])
        n0 = int(ends[e0, 0]) - 1
        u, e_cur = n0, e0
        while True:
            sn = int(ends[e_cur, 0]) - 1
            fn = int(ends[e_cur, 1]) - 1
            v = fn if sn == u else sn
            cycle_nodes.append(u)
            cycle_elems.append(e_cur)
            if v == n0:
                break
            nxt = [e for _, e in adj[v] if alive_e[e] and e != e_cur]
            u, e_cur = v, nxt[0]
        # signed area enclosed by the walk (shoelace)
        for k, u in enumerate(cycle_nodes):
            v = cycle_nodes[(k + 1) % len(cycle_nodes)]
            cell_area += (coord[u, 0] * coord[v, 1] - coord[v, 0] * coord[u, 1]) / 2
        section = 'close' if len(cycle_elems) == nele else 'arbitrary'
    else:
        section = 'open'

    return {'section': section, 'adj': adj, 'start': start,
            'cycle_nodes': cycle_nodes, 'cycle_elems': cycle_elems,
            'cell_area': cell_area}


def _sectorial(coord, ends, L, t, topo, px, py):
    """Saint-Venant warping function at the nodes for pole (px, py).

    Open parts: d(omega) = rho ds. Along a cell: d(omega) = (rho - psi/t) ds with
    psi = 2*Ae/sum(L/t), so omega is single valued around the cell whatever the
    element numbering or direction.
    """
    w = np.zeros(coord.shape[0])

    def cross(u, v):
        return ((coord[u, 0] - px) * (coord[v, 1] - py) -
                (coord[v, 0] - px) * (coord[u, 1] - py))

    done_e = np.zeros(ends.shape[0], dtype=bool)
    visited = set()
    cyc_n = topo['cycle_nodes']
    if cyc_n:
        cyc_e = topo['cycle_elems']
        psi = 2 * topo['cell_area'] / np.sum(L[cyc_e] / t[cyc_e])
        for k, e in enumerate(cyc_e):
            u = cyc_n[k]
            v = cyc_n[(k + 1) % len(cyc_n)]
            if k < len(cyc_e) - 1:
                w[v] = w[u] + cross(u, v) - psi * L[e] / t[e]
            done_e[e] = True
            visited.add(u)
        queue = list(cyc_n)
    else:
        visited.add(topo['start'])
        queue = [topo['start']]

    adj = topo['adj']
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        for v, e in adj[u]:
            if done_e[e]:
                continue
            done_e[e] = True
            if v not in visited:
                w[v] = w[u] + cross(u, v)
                visited.add(v)
                queue.append(v)
    return w


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
    # MATLAB yDOFs.m:34 uses the row-vector convention CG=[xcg,zcg]*rot, which is
    # mathematically rot.T @ [xcg,zcg] (a rotation by -th), NOT rot @ [xcg,zcg].
    # For thetap != 0 these differ, so use rot.T to reproduce MATLAB exactly.
    CG = rot.T @ np.array([xcg, zcg])

    # Create y-DOFs for global buckling
    dy = np.zeros((nmno, 4))
    for i in range(nmno):
        orig_node = int(m_node[i, 3])  # 1-based original node number
        # MATLAB yDOFs.m:42  XZi=[m_node(i,2),m_node(i,3)]*rot  ==  rot.T @ v
        XZi = rot.T @ np.array([m_node[i, 1], m_node[i, 2]])
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
        # MATLAB yDOFs.m:80 does ch=chol(Ryd) with no fallback: for a valid open
        # thin-walled meta-section Ryd (=Rysm'*A*Rysm) is symmetric positive definite.
        # A non-PD Ryd indicates degenerate/closed/branched geometry the cFSM modal
        # decomposition cannot meaningfully handle, so fail loudly rather than
        # regularize (which would perturb the distortional basis inconsistently with
        # the Ryd reused below in the Rayleigh-quotient eigenproblem).
        try:
            ch = la.cholesky(Ryd, lower=False)  # upper triangular
        except la.LinAlgError as exc:
            raise np.linalg.LinAlgError(
                "distortional Ryd not positive definite -- check section geometry "
                "(cFSM requires an open, non-branched meta-cross-section)"
            ) from exc

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

        if jjunk4.shape[1] > ndm:
            # MATLAB yDOFs.m:101 assigns jjunk4*V into exactly ndm columns and stops
            # with a size mismatch otherwise; keeping the first ndm vectors would
            # pick an arbitrary part of the distortional space.
            raise np.linalg.LinAlgError(
                f"distortional null-space provides {jjunk4.shape[1]} vectors but "
                f"{ndm} distortional mode(s) are expected -- check section geometry")
        if jjunk4.shape[1] == ndm:
            junk3 = jjunk4.T @ Ryd @ jjunk4
            try:
                eigvals, V = la.eigh(junk3)
            except la.LinAlgError:
                eigvals, V = np.linalg.eigh(junk3)

            # Append distortional DOFs
            dy = np.hstack([dy, jjunk4 @ V])
        else:
            # MATLAB yDOFs.m:101 (dy(:,(ngm+1):(ngm+ndm))=jjunk4*V) requires the
            # distortional null-space jjunk4 to supply exactly ndm independent
            # vectors. A shortfall means the meta-cross-section is geometrically
            # degenerate (branched/near-degenerate). Silently zero-padding here would
            # produce rank-deficient distortional base vectors, make b_v singular,
            # and let mode_class mis-apportion the %D participation across degenerate
            # columns. ndm is consumed downstream (b_v_m column slicing, classify
            # bookkeeping), so it cannot be reduced locally without corrupting column
            # counts -- fail loudly instead.
            raise np.linalg.LinAlgError(
                f"distortional null-space provides only {jjunk4.shape[1]} "
                f"independent vector(s) but {ndm} distortional mode(s) are required "
                "-- check section geometry (degenerate/branched meta-cross-section)"
            )

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
    from .node_utils import base_properties, check_cfsm_model
    from .constraints import mode_constr

    # GBT base vectors exist only for one connected open section (MATLAB
    # base_column.m: "the cross-section must not be closed"). Without this check a
    # closed section fails deep inside null_space with "array must not contain infs
    # or NaNs". Rounded and branched sections still get base vectors here; modal
    # *classification* refuses them separately (cfsm.classify).
    chk = check_cfsm_model(node, elem)
    if not chk['supported'] and chk['code'] not in ('ROUNDED_CORNER', 'BRANCHED_SECTION'):
        raise ValueError(f"cFSM base vectors: {chk['message']} "
                         "(cFSM supports open sections only)")

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
        ospace: O-space option. The numbering differs between the two branches,
            exactly as in MATLAB base_update.m:
              couple=1: 1 = ST basis, 2 = null(GDL') w.r.t. K, 3 = w.r.t. Kg,
                        4 = null(GDL') in vector sense
              couple=2: 1, 2 = ST basis (2 only triggers the orthogonalization),
                        3 = w.r.t. K, 4 = w.r.t. Kg, 5 = vector sense
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
        b_v: updated base vectors. Whole G/D/L/O spaces do not depend on orth or
        normal, but the individual columns do: with orth=1 column k of a space is
        the k-th natural mode (G: axial, bending 1, bending 2, warping); with
        orth=2/3 it is the k-th lowest mode of that space. A selection vector
        that picks individual modes therefore means a different mode per basis.
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
                                except Exception:
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
        # Coupled basis.
        # Columns the options below do not touch keep the natural basis: MATLAB
        # base_update.m starts from zeros and never fills b_v for orth=1 with
        # ospace=1, which made the coupled natural basis a zero matrix.
        b_v = b_v_l.copy()
        K = None
        Kg = None
        # O-space numbering of the coupled branch is MATLAB's (base_update.m:247-270):
        # 1/2 natural ST O-space, 3 = K, 4 = Kg, 5 = vector null space -- one higher
        # than the uncoupled branch. Kept as is so CUFSM models saved with couple=2
        # solve with the same O-space.
        orth_block = orth in (2, 3) or ospace in (2, 3, 4)
        if normal in (2, 3) or orth in (2, 3) or orth_block or ospace in (3, 4):
            elprop_arr = elemprop(node, elem)
            node_work = node.copy()
            if orth in (1, 2):
                node_work[:, 7] = 1.0

            # Block-diagonal K, Kg: the single-m element matrices are used, so the
            # m-p coupling terms of non S-S end conditions are not included here.
            K = np.zeros((4 * nnodes * totalm, 4 * nnodes * totalm))
            Kg = np.zeros((4 * nnodes * totalm, 4 * nnodes * totalm))

            for ml in range(totalm):
                K_m, Kg_m = create_Ks(m_a[ml], node_work, elem, elprop_arr, prop, a, BC)
                r0 = ndof_m * ml
                r1 = ndof_m * (ml + 1)
                K[r0:r1, r0:r1] = K_m
                Kg[r0:r1, r0:r1] = Kg_m

        if orth_block or ospace == 5:
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

            # Define O-space (null space of GDL) -- MATLAB numbering 3 K, 4 Kg, 5 vector
            if ospace in (3, 4, 5):
                A_null = la.null_space(b_v_GDL.T)
                if ospace == 3:
                    b_v_O = np.linalg.solve(K, A_null)
                elif ospace == 4:
                    b_v_O = np.linalg.solve(Kg, A_null)
                else:
                    b_v_O = A_null
                # MATLAB base_update.m:251-253 assigns columns of b_v (the Python port
                # assigned rows, which failed for more than one m term)
                for ml in range(totalm):
                    c0 = ml * ndof_m + dofindex[3, 0]
                    c1 = ml * ndof_m + dofindex[3, 1] + 1
                    b_v[:, c0:c1] = b_v_O[:, ml * nom:(ml + 1) * nom]

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
                            eigvals, V = la.eig(Ksub, Kgsub)
                            eigvals = np.real(eigvals)
                            V = np.real(V)

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


def constrained_selection_notes(GBTcon, prop=None):
    """Caveats that belong with a cFSM-constrained solution for this selection.

    Returns a list of diagnostics {'severity', 'category', 'code', 'message', ...};
    'category' is the FIXES §3.1.1 list the message belongs to ('warning' /
    'assumption'):
      CFSM_PURE_G_NOT_PCRE (warning): only global modes are selected. The cFSM G
        space enforces zero transverse membrane strain, so with E1 = E/(1-nu^2)
        the pure-G load factor is 1/(1-nu^2) (~1.099 for steel) above the
        classical Euler / flexural-torsional value and above the unconstrained
        FSM curve; used as Pcre it is unconservative by that amount.
      CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT (info): some class vector selects only
        part of its modes. Which physical mode an index means depends on orth
        (and couple/ospace): natural basis (orth=1) G2 = bending about axis 1,
        modal basis (orth=2) G2 = second lowest G mode. The settings used are
        returned so the result can be reproduced.
    """
    def vec(name):
        v = GBTcon.get(name, []) if isinstance(GBTcon, dict) else getattr(GBTcon, name, [])
        return np.ravel(np.asarray(v if v is not None else [], dtype=float))

    def opt(name, default):
        if isinstance(GBTcon, dict):
            return GBTcon.get(name, default)
        return getattr(GBTcon, name, default)

    notes = []
    if GBTcon is None:
        return notes
    sel = {k: vec(k) for k in ('glob', 'dist', 'local', 'other')}
    on = {k: float(np.sum(v == 1)) for k, v in sel.items()}
    if sum(on.values()) == 0:
        return notes
    settings = {k: opt(k, None) for k in ('ospace', 'orth', 'couple', 'norm')}
    if on['glob'] > 0 and on['dist'] == on['local'] == on['other'] == 0:
        factor = 1.0 / (1.0 - 0.3**2)
        if prop is not None and np.size(prop) >= 6:
            pr = np.atleast_2d(np.asarray(prop, dtype=float))
            factor = 1.0 / (1.0 - float(pr[0, 3]) * float(pr[0, 4]))
        notes.append({
            'severity': 'warning', 'category': 'warning', 'code': 'CFSM_PURE_G_NOT_PCRE',
            'factor': factor,
            'message': (f'Pure global (G) cFSM solution: about {factor:.3f} x the classical '
                        'Euler/flexural-torsional value (zero transverse strain, '
                        'E/(1-nu^2)). Do not use it as Pcre/Mcre; use the unconstrained '
                        'FSM curve or the closed-form global buckling value.'),
        })
    partial = [k for k, v in sel.items() if v.size and 0 < on[k] < v.size]
    if partial:
        notes.append({
            'severity': 'info', 'category': 'assumption',
            'code': 'CFSM_INDIVIDUAL_MODES_BASIS_DEPENDENT',
            'classes': partial, 'settings': settings,
            'message': (f'Individual modes selected in {", ".join(partial)}: the mode an '
                        f'index refers to depends on the basis (orth={settings["orth"]}, '
                        f'couple={settings["couple"]}, ospace={settings["ospace"]}); '
                        'orth=1 natural modes, orth=2/3 modes sorted by load factor.'),
        })
    return notes


def mode_select(b_v, ngm, ndm, nlm, if_g, if_d, if_l, if_o, ndof_m, m_a):
    """Select required base vectors for mode decomposition.

    Ported from mode_select.m

    Selecting a whole class (all ones) gives a space that does not depend on the
    basis options; selecting individual indices does (see base_update and
    constrained_selection_notes, which also carries the pure-G caveat).

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

    # MATLAB mode_select.m indexes if_g(1:ngm) ... if_o(1:nom); a vector of the
    # wrong length means the selection was made for another cross-section.
    for name, arr, n_req in (('glob', if_g, ngm), ('dist', if_d, ndm),
                             ('local', if_l, nlm), ('other', if_o, nom)):
        n_got = int(np.size(arr))
        if n_got != n_req:
            raise ValueError(
                f"cFSM mode selection: {name} must have length {n_req} for this "
                f"cross-section (got {n_got}); counts are ngm={ngm}, ndm={ndm}, "
                f"nlm={nlm}, nom={nom}")
    if_g, if_d, if_l, if_o = (np.ravel(np.asarray(v, dtype=float))
                              for v in (if_g, if_d, if_l, if_o))

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
