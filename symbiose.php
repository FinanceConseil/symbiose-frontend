<?php
/**
 * Plugin Name: Symbiose
 * Plugin URI:  https://intranet.local/
 * Description: Interface de chat IA pour les collaborateurs, connectée au backend Symbiose Node.js.
 * Version:     1.0.13
 * Author:      Symbiose
 * License:     GPL-2.0+
 * Text Domain: symbiose
 */

defined( 'ABSPATH' ) || exit;

define( 'SYMBIOSE_VERSION',    '1.0.13' );
define( 'SYMBIOSE_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'SYMBIOSE_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

function symbiose_legacy_option_map(): array {
    return [
        'symbiose_backend_url'   => 'fcc_backend_url',
        'symbiose_jwt_secret'    => 'fcc_jwt_secret',
        'symbiose_allowed_roles' => 'fcc_allowed_roles',
    ];
}

function symbiose_get_option( string $option_name, mixed $default = false ): mixed {
    $missing = '__symbiose_missing__';
    $value   = get_option( $option_name, $missing );

    if ( $missing !== $value ) {
        return $value;
    }

    $legacy_option = symbiose_legacy_option_map()[ $option_name ] ?? null;
    if ( null === $legacy_option ) {
        return $default;
    }

    $legacy_value = get_option( $legacy_option, $missing );
    return $missing !== $legacy_value ? $legacy_value : $default;
}

function symbiose_migrate_legacy_options(): void {
    $missing = '__symbiose_missing__';

    foreach ( symbiose_legacy_option_map() as $new_option => $legacy_option ) {
        $current_value = get_option( $new_option, $missing );
        if ( $missing !== $current_value ) {
            continue;
        }

        $legacy_value = get_option( $legacy_option, $missing );
        if ( $missing === $legacy_value ) {
            continue;
        }

        add_option( $new_option, $legacy_value, '', false );
    }
}

function symbiose_maybe_redirect_legacy_admin_pages(): void {
    if ( ! is_admin() ) {
        return;
    }

    $page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
    if ( 'finance-conseil-chat' === $page ) {
        wp_safe_redirect( admin_url( 'options-general.php?page=symbiose' ) );
        exit;
    }

    if ( 'fcc-stats' === $page ) {
        wp_safe_redirect( admin_url( 'options-general.php?page=symbiose-stats' ) );
        exit;
    }
}

function symbiose_get_jwt_audience(): string {
    if ( defined( 'SYMBIOSE_BACKEND_URL' ) && SYMBIOSE_BACKEND_URL ) {
        return (string) SYMBIOSE_BACKEND_URL;
    }

    if ( defined( 'FCC_BACKEND_URL' ) && FCC_BACKEND_URL ) {
        return (string) FCC_BACKEND_URL;
    }

    return 'symbiose-backend';
}

require_once SYMBIOSE_PLUGIN_DIR . 'includes/class-jwt.php';
require_once SYMBIOSE_PLUGIN_DIR . 'includes/class-admin.php';
require_once SYMBIOSE_PLUGIN_DIR . 'includes/class-shortcode.php';

add_action( 'plugins_loaded', function () {
    symbiose_migrate_legacy_options();
    new Symbiose_Admin();
    new Symbiose_Shortcode();
} );

add_action( 'admin_init', 'symbiose_maybe_redirect_legacy_admin_pages' );

register_activation_hook( __FILE__, function () {
    symbiose_migrate_legacy_options();
    flush_rewrite_rules();
} );

register_deactivation_hook( __FILE__, function () {
    flush_rewrite_rules();
} );
