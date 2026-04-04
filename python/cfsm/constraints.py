"""cFSM constraint matrices for mode separation

Ported from MATLAB:
  constr_xz_y.m, constr_planar_xz.m, constr_ys_ym.m,
  constr_yd_yg.m, constr_yu_yd.m, constr_user.m, mode_constr.m

Authors (original MATLAB): S. Adany, B. Schafer, Z. Li
"""

import numpy as np
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


def constr_xz_y(m_node, m_elem):
    """Create Rx, Rz constraint matrices.

    Defines relationship between x,z displacement DOFs of corner nodes
    and the longitudinal y displacement DOFs of all main nodes,
    using GBT-like assumptions.

    Ported from constr_xz_y.m

    Args:
        m_node: main nodes array (1-based indices)
        m_elem: meta-elements array (1-based indices)

    Returns:
        Rx: (ncno, nmno) constraint matrix for x DOFs
        Rz: (ncno, nmno) constraint matrix for z DOFs
    """
    nmel = m_elem.shape[0]
    nmno = m_node.shape[0]

    # Calculate meta-element data
    m_el_dat = np.zeros((nmel, 5))
    for i in range(nmel):
        node1 = int(m_elem[i, 1]) - 1  # 0-based index into m_node
        node2 = int(m_elem[i, 2]) - 1
        x1 = m_node[node1, 1]
        x2 = m_node[node2, 1]
        z1 = m_node[node1, 2]
        z2 = m_node[node2, 2]
        bi = math.sqrt((x2 - x1)**2 + (z2 - z1)**2)
        ai = math.atan2(z2 - z1, x2 - x1)
        si = (z2 - z1) / bi
        ci = (x2 - x1) / bi
        m_el_dat[i, 0] = bi    # elem width, b
        m_el_dat[i, 1] = 1.0 / bi  # 1/b
        m_el_dat[i, 2] = ai    # elem inclination
        m_el_dat[i, 3] = si    # sin
        m_el_dat[i, 4] = ci    # cos

    # Count corner nodes
    ncno = 0
    for i in range(nmno):
        if int(m_node[i, 4]) > 1:
            ncno += 1

    Rx = np.zeros((ncno, nmno))
    Rz = np.zeros((ncno, nmno))
    k = 0

    for i in range(nmno):
        if int(m_node[i, 4]) > 1:
            # Select two non-parallel meta-elements
            elem1_signed = int(m_node[i, 5])  # 1-based, signed
            j = 6
            # Find a non-parallel element
            while j < m_node.shape[1] and int(m_node[i, j]) != 0:
                elem_candidate = int(m_node[i, j])
                angle_diff = m_el_dat[abs(elem_candidate) - 1, 2] - m_el_dat[abs(elem1_signed) - 1, 2]
                if abs(math.sin(angle_diff)) > 1e-10:
                    break
                j += 1
            if j >= m_node.shape[1] or int(m_node[i, j]) == 0:
                k += 1
                continue
            elem2_signed = int(m_node[i, j])

            # Define main nodes (mnode1, mnode2, mnode3) -- all 0-based indices
            mnode2 = i
            if elem1_signed > 0:
                mnode1 = int(m_elem[elem1_signed - 1, 2]) - 1  # far node
            else:
                mnode1 = int(m_elem[-elem1_signed - 1, 1]) - 1
            if elem2_signed > 0:
                mnode3 = int(m_elem[elem2_signed - 1, 2]) - 1
            else:
                mnode3 = int(m_elem[-elem2_signed - 1, 1]) - 1

            # Get element data
            r1 = m_el_dat[abs(elem1_signed) - 1, 1]  # 1/b
            alfa1 = m_el_dat[abs(elem1_signed) - 1, 2]
            sin1 = m_el_dat[abs(elem1_signed) - 1, 3]
            cos1 = m_el_dat[abs(elem1_signed) - 1, 4]
            if elem1_signed > 0:
                alfa1 = alfa1 - math.pi
                sin1 = -sin1
                cos1 = -cos1

            r2 = m_el_dat[abs(elem2_signed) - 1, 1]
            alfa2 = m_el_dat[abs(elem2_signed) - 1, 2]
            sin2 = m_el_dat[abs(elem2_signed) - 1, 3]
            cos2 = m_el_dat[abs(elem2_signed) - 1, 4]
            if elem2_signed < 0:
                alfa2 = alfa2 - math.pi
                sin2 = -sin2
                cos2 = -cos2

            det = math.sin(alfa2 - alfa1)
            if abs(det) < 1e-15:
                k += 1
                continue

            # Form Rx, Rz matrices
            Rx[k, mnode1] = sin2 * r1 / det
            Rx[k, mnode2] = (-sin1 * r2 - sin2 * r1) / det
            Rx[k, mnode3] = sin1 * r2 / det

            Rz[k, mnode1] = -cos2 * r1 / det
            Rz[k, mnode2] = (cos1 * r2 + cos2 * r1) / det
            Rz[k, mnode3] = -cos1 * r2 / det

            k += 1

    return Rx, Rz


def constr_planar_xz(node, elem, prop, node_prop, DOFperm, m, a, BC):
    """Create Rp constraint matrix for planar DOFs.

    Defines relationship between x,z DOFs of non-corner nodes + theta DOFs
    and the x,z DOFs of corner nodes, using GBT assumptions.

    Ported from constr_planar_xz.m

    Args:
        node, elem, prop: model data
        node_prop: (nnodes, 4) node classification
        DOFperm: DOF permutation matrix
        m: half-wave number
        a: member length
        BC: boundary condition string

    Returns:
        Rp: constraint matrix
    """
    from .stiffness import Kglobal_transv
    from .node_utils import node_class

    nno = node_prop.shape[0]
    nmno, ncno, nsno = node_class(node_prop)

    ndof = 4 * nno

    # Create global transverse stiffness matrix
    K = Kglobal_transv(node, elem, prop, m, a, BC)

    # Re-order DOFs
    K = DOFperm.T @ K @ DOFperm

    # Partition K
    # In the new DOF ordering:
    #   rows/cols 0..nmno-1: y DOFs of main nodes
    #   rows/cols nmno..nmno+2*ncno-1: x,z DOFs of corner nodes
    #   rows/cols nmno+2*ncno..ndof-nsno-1: other planar DOFs (Kpp)
    #   rows/cols ndof-nsno..ndof-1: sub-node y DOFs
    p_start = nmno + 2 * ncno
    p_end = ndof - nsno
    c_start = nmno
    c_end = nmno + 2 * ncno

    Kpp = K[p_start:p_end, p_start:p_end]
    Kpc = K[p_start:p_end, c_start:c_end]

    # Rp = -Kpp \ Kpc
    if Kpp.shape[0] > 0 and Kpp.shape[1] > 0:
        try:
            Rp = -np.linalg.solve(Kpp, Kpc)
        except np.linalg.LinAlgError:
            Rp = -np.linalg.lstsq(Kpp, Kpc, rcond=None)[0]
    else:
        Rp = np.zeros((0, 2 * ncno))

    return Rp


def constr_ys_ym(node, m_node, m_elem, node_prop):
    """Create Rys constraint matrix for sub-node y DOFs.

    Defines sub-node y displacements as linear interpolation
    of main-node y displacements.

    Ported from constr_ys_ym.m

    Args:
        node: (nnodes, 8)
        m_node: main nodes array
        m_elem: meta-elements array
        node_prop: (nnodes, 4) node classification

    Returns:
        Rys: (nsno, nmno) constraint matrix
    """
    nnode = node.shape[0]
    nsno = 0
    for i in range(nnode):
        if int(node_prop[i, 3]) == 3:
            nsno += 1
    nmno = m_node.shape[0]

    Rys = np.zeros((nsno, nmno))

    nmel = m_elem.shape[0]
    for i in range(nmel):
        if int(m_elem[i, 3]) > 0:  # has sub-nodes
            # Main-node endpoints of this meta-element (1-based m_node indices)
            mn1 = int(m_elem[i, 1]) - 1  # 0-based index into m_node
            mn2 = int(m_elem[i, 2]) - 1
            nod1 = int(m_node[mn1, 3])  # original node number (1-based)
            nod3 = int(m_node[mn2, 3])

            x1 = node[nod1 - 1, 1]
            x3 = node[nod3 - 1, 1]
            z1 = node[nod1 - 1, 2]
            z3 = node[nod3 - 1, 2]
            bm = math.sqrt((x3 - x1)**2 + (z3 - z1)**2)

            nnew1 = int(node_prop[nod1 - 1, 1])  # new node number (1-based)
            nnew3 = int(node_prop[nod3 - 1, 1])

            nsub = int(m_elem[i, 3])
            for j in range(nsub):
                nod2 = int(m_elem[i, 4 + j])  # sub-node original number (1-based)
                x2 = node[nod2 - 1, 1]
                z2 = node[nod2 - 1, 2]
                bs = math.sqrt((x2 - x1)**2 + (z2 - z1)**2)
                nnew2 = int(node_prop[nod2 - 1, 1])  # new node number (1-based)

                # Rys row index: (nnew2 - nmno) is 1-based, so subtract 1 for 0-based
                row_idx = nnew2 - nmno - 1
                col1 = nnew1 - 1  # 0-based column
                col3 = nnew3 - 1
                if 0 <= row_idx < nsno:
                    Rys[row_idx, col1] = (bm - bs) / bm
                    Rys[row_idx, col3] = bs / bm

    return Rys


def constr_yd_yg(node, elem, node_prop, Rys, nmno):
    """Create Ryd constraint matrix for distortional y DOFs.

    Defines relationship between distortional and global base vectors
    for y DOFs of main nodes.

    Ported from constr_yd_yg.m

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5)
        node_prop: (nnodes, 4)
        Rys: (nsno, nmno) sub-node constraint matrix
        nmno: number of main nodes

    Returns:
        Ryd: (nmno, nmno) matrix
    """
    nnode = node.shape[0]
    nelem = elem.shape[0]

    A = np.zeros((nnode, nnode))
    for i in range(nelem):
        node1_1b = int(elem[i, 1])
        node2_1b = int(elem[i, 2])
        dx = node[node2_1b - 1, 1] - node[node1_1b - 1, 1]
        dz = node[node2_1b - 1, 2] - node[node1_1b - 1, 2]
        dA = math.sqrt(dx * dx + dz * dz) * elem[i, 3]

        # Map original node numbers to new numbers
        ind1 = node1_1b - 1  # 0-based index into node_prop
        node1_new = int(node_prop[ind1, 1]) - 1  # 0-based new index
        ind2 = node2_1b - 1
        node2_new = int(node_prop[ind2, 1]) - 1

        A[node1_new, node1_new] += 2 * dA
        A[node2_new, node2_new] += 2 * dA
        A[node1_new, node2_new] += dA
        A[node2_new, node1_new] += dA

    # Build Rysm = [I(nmno); Rys]
    Rysm = np.eye(nmno)
    if Rys.shape[0] > 0:
        Rysm = np.vstack([np.eye(nmno), Rys])

    # Ryd = Rysm' * A * Rysm
    n_total = Rysm.shape[0]
    A_sub = A[:n_total, :n_total]
    Ryd = Rysm.T @ A_sub @ Rysm

    return Ryd


def constr_yu_yd(m_node, m_elem):
    """Create Rud constraint matrix for undefinite main node y DOFs.

    For open sections with branches, some main nodes have y DOFs that
    can be computed from other (definite) main nodes' y DOFs.

    Ported from constr_yu_yd.m

    Args:
        m_node: main nodes array
        m_elem: meta-elements array

    Returns:
        Rud: (nmno, nmno) constraint matrix
    """
    nmel = m_elem.shape[0]
    nmno = m_node.shape[0]

    # Calculate meta-element data
    m_el_dat = np.zeros((nmel, 5))
    for i in range(nmel):
        node1 = int(m_elem[i, 1]) - 1  # 0-based into m_node
        node2 = int(m_elem[i, 2]) - 1
        x1 = m_node[node1, 1]
        x2 = m_node[node2, 1]
        z1 = m_node[node1, 2]
        z2 = m_node[node2, 2]
        bi = math.sqrt((x2 - x1)**2 + (z2 - z1)**2)
        ai = math.atan2(z2 - z1, x2 - x1)
        si = (z2 - z1) / bi
        ci = (x2 - x1) / bi
        m_el_dat[i, 0] = bi
        m_el_dat[i, 1] = 1.0 / bi
        m_el_dat[i, 2] = ai
        m_el_dat[i, 3] = si
        m_el_dat[i, 4] = ci

    # Count corner nodes
    ncno = 0
    for i in range(nmno):
        if int(m_node[i, 4]) > 1:
            ncno += 1

    # Register definite and undefinite nodes
    node_reg = np.ones(nmno, dtype=int)
    for i in range(nmno):
        if int(m_node[i, 4]) > 2:
            # Select two non-parallel meta-elements (elem1, elem2)
            elem1_signed = int(m_node[i, 5])
            j = 6
            while j < m_node.shape[1] and int(m_node[i, j]) != 0:
                elem_candidate = int(m_node[i, j])
                angle_diff = m_el_dat[abs(elem_candidate) - 1, 2] - m_el_dat[abs(elem1_signed) - 1, 2]
                if abs(math.sin(angle_diff)) > 1e-10:
                    break
                j += 1
            if j >= m_node.shape[1] or int(m_node[i, j]) == 0:
                continue
            elem2_signed = int(m_node[i, j])

            # Set far nodes of adjacent unselected elements to undefinite
            nadj = int(m_node[i, 4])
            for jj in range(1, nadj):
                elem3 = abs(int(m_node[i, jj + 5]))
                if elem3 != abs(elem2_signed) and elem3 > 0:
                    if int(m_elem[elem3 - 1, 1]) != (i + 1):
                        node_reg[int(m_elem[elem3 - 1, 1]) - 1] = 0
                    else:
                        node_reg[int(m_elem[elem3 - 1, 2]) - 1] = 0

    # Create Rud matrix
    Rud = np.zeros((nmno, nmno))

    # Definite nodes: identity
    for i in range(nmno):
        if node_reg[i] == 1:
            Rud[i, i] = 1.0

    # Undefinite nodes: express in terms of definite nodes
    for i in range(nmno):
        if int(m_node[i, 4]) > 2:
            elem1_signed = int(m_node[i, 5])
            j = 6
            while j < m_node.shape[1] and int(m_node[i, j]) != 0:
                elem_candidate = int(m_node[i, j])
                angle_diff = m_el_dat[abs(elem_candidate) - 1, 2] - m_el_dat[abs(elem1_signed) - 1, 2]
                if abs(math.sin(angle_diff)) > 1e-10:
                    break
                j += 1
            if j >= m_node.shape[1] or int(m_node[i, j]) == 0:
                continue
            elem2_signed = int(m_node[i, j])

            # Define main nodes
            mnode2 = i  # 0-based
            if elem1_signed > 0:
                mnode1 = int(m_elem[elem1_signed - 1, 2]) - 1
            else:
                mnode1 = int(m_elem[-elem1_signed - 1, 1]) - 1
            if elem2_signed > 0:
                mnode3 = int(m_elem[elem2_signed - 1, 2]) - 1
            else:
                mnode3 = int(m_elem[-elem2_signed - 1, 1]) - 1

            # Get element data
            r1 = m_el_dat[abs(elem1_signed) - 1, 1]
            alfa1 = m_el_dat[abs(elem1_signed) - 1, 2]
            sin1 = m_el_dat[abs(elem1_signed) - 1, 3]
            cos1 = m_el_dat[abs(elem1_signed) - 1, 4]
            if elem1_signed > 0:
                alfa1 -= math.pi
                sin1 = -sin1
                cos1 = -cos1

            r2 = m_el_dat[abs(elem2_signed) - 1, 1]
            alfa2 = m_el_dat[abs(elem2_signed) - 1, 2]
            sin2 = m_el_dat[abs(elem2_signed) - 1, 3]
            cos2 = m_el_dat[abs(elem2_signed) - 1, 4]
            if elem2_signed < 0:
                alfa2 -= math.pi
                sin2 = -sin2
                cos2 = -cos2

            det = math.sin(alfa2 - alfa1)
            if abs(det) < 1e-15:
                continue

            r = np.array([[r1, -r1, 0],
                          [0, r2, -r2]])
            cs = np.array([[sin2, -sin1],
                           [-cos2, cos1]])
            csr = cs @ r / det

            nadj = int(m_node[i, 4])
            for jj in range(1, nadj):
                elem3_signed = int(m_node[i, jj + 5])
                if abs(elem3_signed) != abs(elem2_signed) and elem3_signed != 0:
                    if int(m_elem[abs(elem3_signed) - 1, 1]) != (i + 1):
                        mnode4 = int(m_elem[abs(elem3_signed) - 1, 1]) - 1
                    else:
                        mnode4 = int(m_elem[abs(elem3_signed) - 1, 2]) - 1

                    r3 = m_el_dat[abs(elem3_signed) - 1, 1]
                    alfa3 = m_el_dat[abs(elem3_signed) - 1, 2]
                    sin3 = m_el_dat[abs(elem3_signed) - 1, 3]
                    cos3 = m_el_dat[abs(elem3_signed) - 1, 4]
                    if elem3_signed < 0:
                        alfa3 -= math.pi
                        sin3 = -sin3
                        cos3 = -cos3

                    rud = -1.0 / r3 * np.array([cos3, sin3]) @ csr
                    rud[1] += 1.0
                    Rud[mnode4, mnode1] = rud[0]
                    Rud[mnode4, mnode2] = rud[1]
                    Rud[mnode4, mnode3] = rud[2]

    # Completely eliminate undefinite nodes from Rud (iterative)
    max_iter = nmno * 2
    iteration = 0
    changed = True
    while changed and iteration < max_iter:
        changed = False
        iteration += 1
        for i in range(nmno):
            if node_reg[i] == 0:
                ind = np.where(np.abs(Rud[:, i]) > 1e-15)[0]
                if len(ind) > 0:
                    changed = True
                    for jj in ind:
                        Rud[jj, :] = Rud[jj, :] + Rud[i, :] * Rud[jj, i]
                        Rud[jj, i] = 0.0

    return Rud


def constr_user(node, cnstr, m_a):
    """Create user-defined constraint matrix Ruser.

    Ported from constr_user.m

    Args:
        node: (nnodes, 8)
        cnstr: constraints array -- (nconstraints, >=5)
            [nodee, dofe, coeff, nodek, dofk]
        m_a: longitudinal terms array

    Returns:
        Ruser: constraint matrix
    """
    nnode = node.shape[0]
    ndof_m = 4 * nnode
    totalm = len(m_a)

    Ruser = np.zeros((ndof_m * totalm, 0))
    offset_row = 0
    offset_col = 0

    for ml in range(totalm):
        DOFreg = np.ones(ndof_m, dtype=int)
        Ruser_m = np.eye(ndof_m)

        # Consider free DOFs (node columns 3-6 are dofx, dofz, dofy, dofrot)
        for i in range(nnode):
            for j in range(3, 7):  # columns 3,4,5,6 of node array (0-based)
                if node[i, j] == 0:
                    if j == 3:    # dofx
                        dofe = i * 2      # 0-based
                    elif j == 5:  # dofy
                        dofe = i * 2 + 1
                    elif j == 4:  # dofz
                        dofe = nnode * 2 + i * 2
                    elif j == 6:  # dofrot
                        dofe = nnode * 2 + i * 2 + 1
                    else:
                        continue
                    DOFreg[dofe] = 0

        # Master-slave constraints
        if cnstr is not None and cnstr.size > 0:
            nc = cnstr.shape[0] if cnstr.ndim > 1 else 1
            if cnstr.ndim == 1:
                cnstr = cnstr.reshape(1, -1)
            for i in range(nc):
                if cnstr.shape[1] >= 5:
                    nodee = int(cnstr[i, 0])  # 1-based
                    dof_e = int(cnstr[i, 1])
                    coeff = cnstr[i, 2]
                    nodek = int(cnstr[i, 3])  # 1-based
                    dof_k = int(cnstr[i, 4])

                    # Map to DOF index (0-based)
                    dofe = _dof_index_matlab(nodee, dof_e, nnode)
                    dofk = _dof_index_matlab(nodek, dof_k, nnode)

                    if dofe >= 0 and dofk >= 0:
                        Ruser_m[:, dofk] += coeff * Ruser_m[:, dofe]
                        DOFreg[dofe] = 0

        # Eliminate fixed DOFs
        free_cols = np.where(DOFreg == 1)[0]
        Ru = Ruser_m[:, free_cols]
        k = len(free_cols)

        # Build block for this m-term
        if ml == 0:
            Ruser = np.zeros((ndof_m * totalm, k * totalm))
        Ruser[ml * ndof_m:(ml + 1) * ndof_m, ml * k:(ml + 1) * k] = Ru

    return Ruser


def _dof_index_matlab(node_1b, dof_type, nnode):
    """Convert MATLAB-style DOF type to 0-based DOF index.

    MATLAB convention:
        dof_type 1 => x DOF: (node-1)*2
        dof_type 3 => y DOF: node*2 - 1
        dof_type 2 => z DOF: nnode*2 + (node-1)*2
        dof_type 4 => theta: nnode*2 + node*2 - 1
    """
    if dof_type == 1:
        return (node_1b - 1) * 2
    elif dof_type == 3:
        return node_1b * 2 - 1
    elif dof_type == 2:
        return nnode * 2 + (node_1b - 1) * 2
    elif dof_type == 4:
        return nnode * 2 + node_1b * 2 - 1
    return -1


def mode_constr(node, elem, prop, node_prop, m_node, m_elem, DOFperm, m, a, BC):
    """Create all constraint matrices for mode separation.

    Ported from mode_constr.m

    Args:
        node, elem, prop: model data
        node_prop: (nnodes, 4) node classification
        m_node: main nodes array
        m_elem: meta-elements array
        DOFperm: DOF permutation matrix
        m: half-wave number
        a: member length
        BC: boundary condition string

    Returns:
        Rx, Rz: x,z constraint matrices
        Rp: planar constraint matrix
        Ryd: distortional y DOF constraint matrix
        Rys: sub-node y DOF constraint matrix
        Rud: undefinite node constraint matrix
    """
    from .node_utils import node_class

    # Rx, Rz
    Rx, Rz = constr_xz_y(m_node, m_elem)

    # Rp
    Rp = constr_planar_xz(node, elem, prop, node_prop, DOFperm, m, a, BC)

    # Rys
    Rys = constr_ys_ym(node, m_node, m_elem, node_prop)

    # Ryd
    nmno = m_node.shape[0]
    Ryd = constr_yd_yg(node, elem, node_prop, Rys, nmno)

    # Rud
    Rud = constr_yu_yd(m_node, m_elem)

    return Rx, Rz, Rp, Ryd, Rys, Rud
