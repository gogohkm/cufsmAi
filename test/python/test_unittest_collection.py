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
        "test_web_crippling_c_z_separation",
        "test_web_crippling_overhang_eq_g52",
        "test_web_crippling_overhang_definition_limit",
        "test_web_crippling_itf_edge_distance_validation",
        "test_web_crippling_built_up_i_table_g51",
        "test_web_crippling_built_up_i_unsupported_unstiffened_two_flange",
        "test_web_crippling_hat_per_web_multiplier",
        "test_web_crippling_multiweb_spacing_override",
        "test_dsm_boundary_minima",
        "test_uplift_combo_reaction_based",
        "test_auto_generate_passes_corner_radius",
        "test_h3_web_configs",
        "test_kx_responds_to_pss",
        "test_multi_bolt_c_factor",
        "test_beam_fe_solve_flag",
        "test_screw_connection_interpolation_and_pullover",
        "test_arc_spot_effective_diameter_cap",
        "test_arc_seam_formula_terms",
        "test_paf_limit_state_mapping",
        "test_auto_generate_uses_bending_curve_for_flexure_dsm",
        "test_flexure_design_section_type_affects_fcre",
        "test_cold_work_uses_estimated_corner_ratio",
        "test_flexure_h3_respects_fastened_and_web_config",
        "test_flexure_design_passes_built_up_i_and_edge_distance",
        "test_webview_design_state_roundtrip",
        "test_webview_design_prepare_contract",
        "test_flexure_design_auto_infers_hat_family_and_webs",
        "test_flexure_design_auto_infers_multiweb_family_from_section_hint",
    )),
)


def _wrap_test_function(func):
    def _runner():
        result = func()
        if result is False:
            raise AssertionError(f"{func.__module__}.{func.__name__} reported failure")
    return _runner


def load_tests(loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str):
    suite = unittest.TestSuite()
    for module, function_names in TEST_FUNCTIONS:
        for function_name in function_names:
            func = getattr(module, function_name)
            suite.addTest(unittest.FunctionTestCase(
                _wrap_test_function(func),
                description=f"{module.__name__}.{function_name}",
            ))
    return suite
