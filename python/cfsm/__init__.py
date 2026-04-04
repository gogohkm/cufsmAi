"""cFSM (constrained Finite Strip Method) package

Provides modal decomposition and classification of buckling modes
into Global (G), Distortional (D), Local (L), and Other (O) categories
based on GBT (Generalized Beam Theory) assumptions.

Port of the MATLAB cFSM module (~2646 lines, 30 files) by
S. Adany, B. Schafer, and Z. Li.
"""

from .classify import classify
from .base_vectors import base_column, base_update, base_vectors
from .node_utils import (
    meta_elems, node_class, mode_nr, DOF_ordering, base_properties,
)
from .constraints import (
    constr_xz_y, constr_planar_xz, constr_ys_ym, constr_yd_yg,
    constr_yu_yd, constr_user, mode_constr,
)
from .stiffness import (
    klocal_transv, trans_single, assemble_single, Kglobal_transv,
    klocal_m, kglocal_m, trans_m, assemble_m, create_Ks,
)
