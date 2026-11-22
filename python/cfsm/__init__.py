"""cFSM (constrained Finite Strip Method) package

Provides modal decomposition and classification of buckling modes
into Global (G), Distortional (D), Local (L), and Other (O) categories
based on GBT (Generalized Beam Theory) assumptions.

Port of the MATLAB cFSM module (~2646 lines, 30 files) by
S. Adany, B. Schafer, and Z. Li.
"""

from .classify import classify, CfsmClassification, CUFSM_CLASSIFY_DEFAULTS
from .base_vectors import (base_column, base_update, base_vectors,
                           constrained_selection_notes)
from .node_utils import (
    meta_elems, node_class, mode_nr, DOF_ordering, base_properties,
    check_cfsm_model,
)
from .constraints import (
    constr_xz_y, constr_planar_xz, constr_ys_ym, constr_yd_yg,
    constr_yu_yd, constr_user, mode_constr,
)
from .stiffness import (
    klocal_transv, trans_single, assemble_single, Kglobal_transv,
    klocal_m, kglocal_m, trans_m, assemble_m, create_Ks,
)

__all__ = [
    'classify', 'CfsmClassification', 'CUFSM_CLASSIFY_DEFAULTS', 'check_cfsm_model',
    'base_column', 'base_update', 'base_vectors', 'constrained_selection_notes',
    'meta_elems', 'node_class', 'mode_nr', 'DOF_ordering', 'base_properties',
    'constr_xz_y', 'constr_planar_xz', 'constr_ys_ym', 'constr_yd_yg',
    'constr_yu_yd', 'constr_user', 'mode_constr',
    'klocal_transv', 'trans_single', 'assemble_single', 'Kglobal_transv',
    'klocal_m', 'kglocal_m', 'trans_m', 'assemble_m', 'create_Ks',
]
