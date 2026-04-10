"""unittest discovery entrypoint for the script-style regression suites."""

import unittest

import test_design_verification
import test_element
import test_solver


TEST_FUNCTIONS = (
    (test_solver, (
        "test_grosprop",
        "test_elemprop",
        "test_trans",
        "test_assembly",
        "test_stripmain_basic",
        "test_stripmain_all_bc",
        "test_stresgen",
        "test_yieldMP",
        "test_template_all_types",
    )),
    (test_element, (
        "test_bc_i1_5_ss",
        "test_bc_i1_5_all_types",
        "test_klocal_shape",
        "test_klocal_symmetry",
        "test_kglocal_shape",
        "test_kglocal_symmetry",
        "test_spring_klocal_shape",
    )),
    (test_design_verification, (
        "test_beam_analysis_4span",
        "test_load_combinations",
        "test_distortional_params_example_ii5",
        "test_web_crippling_example_ii1a",
        "test_shear_strength",
        "test_dsm_flexure_example_ii1b",
        "test_dsm_compression",
        "test_i621_uplift_r",
        "test_cb_moment_gradient",
        "test_beta_distortional",
        "test_analyze_loads_integration",
        "test_deck_stiffness",
        "test_interaction_checks",
        "test_connection_bolt",
        "test_shear_lag_design_strength_split",
        "test_connection_arc_spot_uses_diameter_input",
        "test_combined_requires_explicit_weak_axis_strength",
        "test_lap_connection_uses_shared_connection_engine",
    )),
)


def load_tests(loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str):
    suite = unittest.TestSuite()
    for module, function_names in TEST_FUNCTIONS:
        for function_name in function_names:
            func = getattr(module, function_name)
            suite.addTest(unittest.FunctionTestCase(
                func,
                description=f"{module.__name__}.{function_name}",
            ))
    return suite
