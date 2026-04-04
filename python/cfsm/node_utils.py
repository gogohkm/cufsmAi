"""cFSM node classification and meta-element utilities

Ported from MATLAB: meta_elems.m, node_class.m, mode_nr.m,
DOF_ordering.m, base_properties.m

Authors (original MATLAB): S. Adany, B. Schafer, Z. Li
"""

import numpy as np
import math
import sys
import os

# Add parent directory to path so engine imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine.properties import elemprop


def meta_elems(node, elem):
    """Re-organise cross-section data to form meta-elements.

    Eliminates internal subdividing nodes (sub-nodes) and forms
    meta-elements (corner-to-corner or corner-to-free-edge).

    Args:
        node: (nnodes, 8) -- [node#, x, z, dofx, dofz, dofy, dofrot, stress]
        elem: (nelems, 5) -- [elem#, nodei, nodej, t, matnum]
              node numbers are MATLAB 1-based

    Returns:
        m_node: main nodes array
            [nr, x, z, orig_node_nr, nr_adj_meta_elems, m_el_1, m_el_2, ...]
            All indices are 1-based (MATLAB convention)
        m_elem: meta-elements array
            [nr, main_node_1, main_node_2, nr_sub_nodes, sub_node_1, ...]
            Node numbers here are NEW (re-numbered) main node numbers (1-based)
        node_prop: (nnodes, 4)
            [orig_node_nr(1-based), new_node_nr(1-based), nr_adj_elems, node_type]
            node_type: 1=corner, 2=edge, 3=sub
    """
    nnode = node.shape[0]
    nelem = elem.shape[0]

    # Count number of elements connecting to each node
    # + register internal nodes to be eliminated
    # + set node type (node_prop[:,3])
    # Use 1-based node numbering throughout, matching MATLAB
    node_prop = np.zeros((nnode, 4))
    node_prop[:, 0] = np.arange(1, nnode + 1)  # original node nr (1-based)

    for i in range(nnode):
        mel = 0
        els = []
        for j in range(nelem):
            # elem[:,1] and elem[:,2] are 1-based node numbers
            if int(elem[j, 1]) == (i + 1) or int(elem[j, 2]) == (i + 1):
                mel += 1
                els.append(j)
        node_prop[i, 2] = mel  # nr of adjacent elements

        if mel == 1:
            node_prop[i, 3] = 2  # edge node
        elif mel >= 2:
            node_prop[i, 3] = 1  # corner node (tentative)

        if mel == 2:
            # Check if this is actually a sub-node (collinear)
            n1 = i  # 0-based
            # Get the other node of the first adjacent element
            n2_1b = int(elem[els[0], 1])  # 1-based
            if n2_1b == (i + 1):
                n2_1b = int(elem[els[0], 2])
            n2 = n2_1b - 1  # 0-based

            n3_1b = int(elem[els[1], 1])
            if n3_1b == (i + 1):
                n3_1b = int(elem[els[1], 2])
            n3 = n3_1b - 1  # 0-based

            a1 = math.atan2(node[n2, 2] - node[n1, 2], node[n2, 1] - node[n1, 1])
            a2 = math.atan2(node[n1, 2] - node[n3, 2], node[n1, 1] - node[n3, 1])

            if abs(a1 - a2) < 1e-7:
                node_prop[i, 2] = 0  # mark for elimination
                node_prop[i, 3] = 3  # sub-node

    # Create meta-elements (with original 1-based node numbers)
    # Start from elem, merge elements through sub-nodes
    max_sub = nnode  # max possible sub-nodes in a meta-element
    m_el = np.zeros((nelem, 4 + max_sub))
    m_el[:, 0] = elem[:, 0]  # element number
    m_el[:, 1] = elem[:, 1]  # nodei (1-based)
    m_el[:, 2] = elem[:, 2]  # nodej (1-based)
    m_el[:, 3] = 0  # nr of sub-nodes

    for i in range(nnode):
        if node_prop[i, 2] == 0:  # sub-node
            node_1b = i + 1
            # Find the two elements containing this sub-node
            k = 0
            els = [0, 0]
            for j in range(nelem):
                if int(m_el[j, 1]) == node_1b or int(m_el[j, 2]) == node_1b:
                    els[k] = j
                    k += 1
                    if k >= 2:
                        break

            # Get the other end nodes
            no1 = int(m_el[els[0], 1])
            if no1 == node_1b:
                no1 = int(m_el[els[0], 2])
            no2 = int(m_el[els[1], 1])
            if no2 == node_1b:
                no2 = int(m_el[els[1], 2])

            # Merge: replace first element's nodes with the two outer nodes
            m_el[els[0], 1] = no1
            m_el[els[0], 2] = no2
            # Zero out second element
            m_el[els[1], 1] = 0
            m_el[els[1], 2] = 0
            # Record sub-node
            nsub = int(m_el[els[0], 3])
            m_el[els[0], 3] = nsub + 1
            m_el[els[0], 4 + nsub] = node_1b  # sub-node number (1-based)

    # Eliminate disappearing elements (those with zeroed nodes)
    nmel = 0
    m_elem_list = []
    for i in range(nelem):
        if int(m_el[i, 1]) != 0 and int(m_el[i, 2]) != 0:
            nmel += 1
            row = m_el[i, :].copy()
            row[0] = nmel  # renumber
            m_elem_list.append(row)

    if nmel > 0:
        m_elem = np.array(m_elem_list)
    else:
        m_elem = np.zeros((0, 4 + max_sub))

    # Create array of main nodes
    nmno = 0
    m_node_list = []
    for i in range(nnode):
        if node_prop[i, 2] != 0:  # not a sub-node
            nmno += 1
            row = np.zeros(5 + nmel + 2)  # extra space for meta-elem refs
            row[0] = nmno  # new number (1-based)
            row[1] = node[i, 1]  # x
            row[2] = node[i, 2]  # z
            row[3] = i + 1  # original node number (1-based)
            row[4] = node_prop[i, 2]  # nr of adjacent elements
            node_prop[i, 1] = nmno  # new node number
            m_node_list.append(row)

    if nmno > 0:
        max_cols = max(len(r) for r in m_node_list)
        m_node = np.zeros((nmno, max_cols))
        for idx, row in enumerate(m_node_list):
            m_node[idx, :len(row)] = row
    else:
        m_node = np.zeros((0, 7))

    # Re-number nodes in m_elem (replace original 1-based with new 1-based)
    for i in range(nnode):
        if node_prop[i, 2] != 0:
            orig_1b = i + 1
            new_1b = int(node_prop[i, 1])
            for j in range(nmel):
                if int(m_elem[j, 1]) == orig_1b:
                    m_elem[j, 1] = new_1b
                if int(m_elem[j, 2]) == orig_1b:
                    m_elem[j, 2] = new_1b

    # Assign meta-elems to main-nodes
    for i in range(nmno):
        k = 5  # column index in m_node
        mnode_1b = i + 1
        for j in range(nmel):
            if int(m_elem[j, 1]) == mnode_1b:
                if k < m_node.shape[1]:
                    m_node[i, k] = j + 1  # positive = start node
                else:
                    m_node = _extend_cols(m_node, k + 1)
                    m_node[i, k] = j + 1
                k += 1
            if int(m_elem[j, 2]) == mnode_1b:
                if k < m_node.shape[1]:
                    m_node[i, k] = -(j + 1)  # negative = end node
                else:
                    m_node = _extend_cols(m_node, k + 1)
                    m_node[i, k] = -(j + 1)
                k += 1

    # Finish node_prop with new numbers for sub-nodes
    nsno = 0
    for i in range(nnode):
        if node_prop[i, 2] == 0:  # sub-node
            nsno += 1
            node_prop[i, 1] = nmno + nsno  # new node number

    return m_node, m_elem, node_prop


def _extend_cols(arr, new_ncols):
    """Extend array columns if needed."""
    if new_ncols <= arr.shape[1]:
        return arr
    new_arr = np.zeros((arr.shape[0], new_ncols))
    new_arr[:, :arr.shape[1]] = arr
    return new_arr


def node_class(node_prop):
    """Determine how many nodes of each type exist.

    Args:
        node_prop: (nnodes, 4) -- [orig_nr, new_nr, nr_adj_elems, node_type]
            node_type: 1=corner, 2=edge, 3=sub

    Returns:
        nmno: number of main nodes (corner + edge)
        ncno: number of corner nodes
        nsno: number of sub-nodes
    """
    nno = node_prop.shape[0]
    ncno = 0
    neno = 0
    nsno = 0
    for i in range(nno):
        if int(node_prop[i, 3]) == 1:
            ncno += 1
        if int(node_prop[i, 3]) == 2:
            neno += 1
        if int(node_prop[i, 3]) == 3:
            nsno += 1
    nmno = ncno + neno
    return nmno, ncno, nsno


def mode_nr(nmno, ncno, nsno, m_node):
    """Determine the number of distortional and local buckling modes.

    Args:
        nmno: number of main nodes
        ncno: number of corner nodes
        nsno: number of sub-nodes
        m_node: main nodes array

    Returns:
        ndm: number of distortional modes
        nlm: number of local modes
    """
    ndm = nmno - 4
    for i in range(nmno):
        if int(m_node[i, 4]) > 2:
            ndm -= (int(m_node[i, 4]) - 2)
    if ndm < 0:
        ndm = 0

    neno = nmno - ncno
    nlm = nmno + 2 * nsno + neno
    return ndm, nlm


def DOF_ordering(node_prop):
    """Re-order DOFs for GBT mode separation.

    Re-orders DOFs according to GBT convention:
      [y_main | x_corner | z_corner | x_edge, z_edge | theta_main |
       x_sub | z_sub | theta_sub | y_sub]

    Args:
        node_prop: (nnodes, 4) -- node classification

    Returns:
        DOFperm: (4*nno, 4*nno) permutation matrix
            such that (orig_displ_vect) = DOFperm * (new_displ_vector)
    """
    nno = node_prop.shape[0]

    # Count node types
    ncno = 0
    neno = 0
    nsno = 0
    for i in range(nno):
        if int(node_prop[i, 3]) == 1:
            ncno += 1
        if int(node_prop[i, 3]) == 2:
            neno += 1
        if int(node_prop[i, 3]) == 3:
            nsno += 1
    nmno = ncno + neno

    DOFperm = np.zeros((4 * nno, 4 * nno))

    # x DOFs
    ic = 0
    ie = 0
    is_ = 0
    for i in range(nno):
        # MATLAB: DOFperm((2*i-1), ...) = 1 => row index = 2*(i+1)-1-1 = 2*i in 0-based
        # Original DOF index for x of node i (0-based) = 2*i
        # In MATLAB (1-based): row = 2*i-1
        # In Python (0-based): row = 2*i
        row = 2 * i  # x DOF of node i in original ordering
        if int(node_prop[i, 3]) == 1:  # corner
            ic += 1
            # new position: nmno + ic (1-based) => nmno + ic - 1 (0-based)
            col = nmno + ic - 1
            DOFperm[row, col] = 1.0
        elif int(node_prop[i, 3]) == 2:  # edge
            ie += 1
            col = nmno + 2 * ncno + ie - 1
            DOFperm[row, col] = 1.0
        elif int(node_prop[i, 3]) == 3:  # sub
            is_ += 1
            col = 4 * nmno + is_ - 1
            DOFperm[row, col] = 1.0

    # y DOFs
    ic = 0
    is_ = 0
    for i in range(nno):
        row = 2 * i + 1  # y DOF of node i in original ordering
        if int(node_prop[i, 3]) == 1 or int(node_prop[i, 3]) == 2:  # corner or edge
            ic += 1
            col = ic - 1  # 0-based
            DOFperm[row, col] = 1.0
        elif int(node_prop[i, 3]) == 3:  # sub
            is_ += 1
            col = 4 * nmno + 3 * nsno + is_ - 1
            DOFperm[row, col] = 1.0

    # z DOFs
    ic = 0
    ie = 0
    is_ = 0
    for i in range(nno):
        row = 2 * nno + 2 * i  # z DOF of node i in original ordering
        if int(node_prop[i, 3]) == 1:  # corner
            ic += 1
            col = nmno + ncno + ic - 1
            DOFperm[row, col] = 1.0
        elif int(node_prop[i, 3]) == 2:  # edge
            ie += 1
            col = nmno + 2 * ncno + neno + ie - 1
            DOFperm[row, col] = 1.0
        elif int(node_prop[i, 3]) == 3:  # sub
            is_ += 1
            col = 4 * nmno + nsno + is_ - 1
            DOFperm[row, col] = 1.0

    # theta DOFs
    ic = 0
    is_ = 0
    for i in range(nno):
        row = 2 * nno + 2 * i + 1  # theta DOF of node i in original ordering
        if int(node_prop[i, 3]) == 1 or int(node_prop[i, 3]) == 2:  # corner or edge
            ic += 1
            col = 3 * nmno + ic - 1
            DOFperm[row, col] = 1.0
        elif int(node_prop[i, 3]) == 3:  # sub
            is_ += 1
            col = 4 * nmno + 2 * nsno + is_ - 1
            DOFperm[row, col] = 1.0

    return DOFperm


def base_properties(node, elem):
    """Create all data for defining base vectors from cross section properties.

    Ported from base_properties.m

    Args:
        node: (nnodes, 8)
        elem: (nelems, 5)

    Returns:
        elprop: element properties (nelems, 3)
        m_node: main nodes array
        m_elem: meta-elements array
        node_prop: node properties (nnodes, 4)
        nmno, ncno, nsno: node counts
        ndm, nlm: mode counts
        DOFperm: DOF permutation matrix
    """
    nnodes = node.shape[0]
    nelems = elem.shape[0]

    elprop_arr = elemprop(node, elem)
    m_node, m_elem, node_prop = meta_elems(node, elem)
    nmno, ncno, nsno = node_class(node_prop)
    ndm, nlm = mode_nr(nmno, ncno, nsno, m_node)
    DOFperm_mat = DOF_ordering(node_prop)

    return elprop_arr, m_node, m_elem, node_prop, nmno, ncno, nsno, ndm, nlm, DOFperm_mat
