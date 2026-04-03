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

function symbiose_get_jwt_audience(): string {
    if ( defined( 'SYMBIOSE_BACKEND_URL' ) && SYMBIOSE_BACKEND_URL ) {
        return (string) SYMBIOSE_BACKEND_URL;
    }

    return 'symbiose-backend';
}

require_once SYMBIOSE_PLUGIN_DIR . 'includes/class-jwt.php';
require_once SYMBIOSE_PLUGIN_DIR . 'includes/class-admin.php';
require_once SYMBIOSE_PLUGIN_DIR . 'includes/class-shortcode.php';

add_action( 'plugins_loaded', function () {
    new Symbiose_Admin();
    new Symbiose_Shortcode();
} );

register_activation_hook( __FILE__, function () {
    flush_rewrite_rules();
} );

register_deactivation_hook( __FILE__, function () {
    flush_rewrite_rules();
} );
