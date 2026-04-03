<?php
defined( 'ABSPATH' ) || exit;

/**
 * Page de configuration WordPress : Settings > Symbiose
 */
class Symbiose_Admin {

    public function __construct() {
        add_action( 'admin_menu',          [ $this, 'add_menu' ] );
        add_action( 'admin_init',          [ $this, 'register_settings' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_stats_assets' ] );
    }

    public function add_menu(): void {
        add_options_page(
            __( 'Symbiose', 'symbiose' ),
            __( 'Symbiose', 'symbiose' ),
            'manage_options',
            'symbiose',
            [ $this, 'render_page' ]
        );

        add_submenu_page(
            'options-general.php',
            __( 'Symbiose – Statistiques', 'symbiose' ),
            __( 'Statistiques', 'symbiose' ),
            'manage_options',
            'symbiose-stats',
            [ $this, 'render_stats_page' ]
        );
    }

    public function enqueue_stats_assets( string $hook ): void {
        if ( 'settings_page_symbiose-stats' !== $hook ) {
            return;
        }
        $secret = (string) symbiose_get_option( 'symbiose_jwt_secret', '' );
        if ( empty( $secret ) ) {
            return;
        }

        wp_enqueue_style(
            'symbiose-admin-stats',
            plugin_dir_url( dirname( __FILE__ ) ) . 'assets/admin/admin-stats.css',
            [],
            SYMBIOSE_VERSION
        );
        wp_enqueue_script(
            'symbiose-admin-stats',
            plugin_dir_url( dirname( __FILE__ ) ) . 'assets/admin/admin-stats.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        $jwt         = $this->build_admin_jwt( $secret );
        $backend_url = $this->get_backend_url();

        wp_localize_script( 'symbiose-admin-stats', 'symbioseAdminConfig', [
            'jwt'        => $jwt,
            'backendUrl' => $backend_url,
        ] );
    }

    public function register_settings(): void {
        // ── Section principale ──────────────────────────────────────────────
        add_settings_section(
            'symbiose_main_section',
            __( 'Configuration du backend', 'symbiose' ),
            '__return_false',
            'symbiose'
        );

        // Champ : URL du backend
        register_setting( 'symbiose_settings_group', 'symbiose_backend_url', [
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_url',
            'default'           => 'http://localhost:3000',
        ] );
        add_settings_field(
            'symbiose_backend_url',
            __( 'URL du backend Node.js', 'symbiose' ),
            [ $this, 'field_backend_url' ],
            'symbiose',
            'symbiose_main_section'
        );

        // Champ : JWT Secret
        register_setting( 'symbiose_settings_group', 'symbiose_jwt_secret', [
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ] );
        add_settings_field(
            'symbiose_jwt_secret',
            __( 'JWT Secret', 'symbiose' ),
            [ $this, 'field_jwt_secret' ],
            'symbiose',
            'symbiose_main_section'
        );

        // Champ : Rôles autorisés
        register_setting( 'symbiose_settings_group', 'symbiose_allowed_roles', [
            'type'              => 'array',
            'sanitize_callback' => [ $this, 'sanitize_roles' ],
            'default'           => [ 'administrator' ],
        ] );
        add_settings_field(
            'symbiose_allowed_roles',
            __( 'Rôles WordPress autorisés', 'symbiose' ),
            [ $this, 'field_allowed_roles' ],
            'symbiose',
            'symbiose_main_section'
        );
    }

    // ── Rendus des champs ────────────────────────────────────────────────────

    public function field_backend_url(): void {
        $value = esc_attr( (string) symbiose_get_option( 'symbiose_backend_url', 'http://localhost:3000' ) );
        echo '<input type="url" id="symbiose_backend_url" name="symbiose_backend_url" value="' . $value . '" class="regular-text" placeholder="http://localhost:3000">';
        echo '<p class="description">' . esc_html__( 'URL de base du serveur Node.js (sans slash final).', 'symbiose' ) . '</p>';
    }

    public function field_jwt_secret(): void {
        $value = esc_attr( (string) symbiose_get_option( 'symbiose_jwt_secret', '' ) );
        echo '<input type="password" id="symbiose_jwt_secret" name="symbiose_jwt_secret" value="' . $value . '" class="regular-text" autocomplete="new-password">';
        echo '<p class="description">' . esc_html__( 'Clé secrète partagée avec le backend pour signer les JWT HS256.', 'symbiose' ) . '</p>';
    }

    public function field_allowed_roles(): void {
        $saved_roles = (array) symbiose_get_option( 'symbiose_allowed_roles', [ 'administrator' ] );
        $wp_roles    = wp_roles()->roles;

        echo '<select id="symbiose_allowed_roles" name="symbiose_allowed_roles[]" multiple size="' . count( $wp_roles ) . '" style="min-width:200px">';
        foreach ( $wp_roles as $role_slug => $role_data ) {
            $selected = in_array( $role_slug, $saved_roles, true ) ? ' selected' : '';
            echo '<option value="' . esc_attr( $role_slug ) . '"' . $selected . '>' . esc_html( $role_data['name'] ) . '</option>';
        }
        echo '</select>';
        echo '<p class="description">' . esc_html__( 'Maintenez Ctrl/Cmd pour sélectionner plusieurs rôles.', 'symbiose' ) . '</p>';
    }

    // ── Sanitisation ─────────────────────────────────────────────────────────

    public function sanitize_roles( mixed $input ): array {
        if ( ! is_array( $input ) ) {
            return [];
        }
        $valid_roles = array_keys( wp_roles()->roles );
        return array_values( array_intersect( (array) $input, $valid_roles ) );
    }

    private function get_backend_url(): string {
        return rtrim( (string) symbiose_get_option( 'symbiose_backend_url', 'http://localhost:3000' ), '/' );
    }

    private function build_admin_jwt( string $secret ): string {
        $user  = wp_get_current_user();
        $roles = array_values( array_map( 'strval', (array) $user->roles ) );

        return Symbiose_JWT::encode(
            [
                'wp_user_id'   => $user->ID,
                'wp_roles'     => $roles,
                'display_name' => $user->display_name,
                'email'        => $user->user_email,
                'is_admin'     => true,
                'aud'          => symbiose_get_jwt_audience(),
            ],
            $secret,
            3600
        );
    }

    // ── Pages de rendu ───────────────────────────────────────────────────────

    public function render_stats_page(): void {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( esc_html__( 'Accès non autorisé.', 'symbiose' ) );
        }
        ?>
        <div class="wrap">
            <h1><?php esc_html_e( 'Symbiose – Statistiques', 'symbiose' ); ?></h1>
            <div id="symbiose-admin-stats"></div>
        </div>
        <?php
    }

    public function render_page(): void {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( esc_html__( 'Accès non autorisé.', 'symbiose' ) );
        }
        ?>
        <div class="wrap">
            <h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
            <form method="post" action="options.php">
                <?php
                settings_fields( 'symbiose_settings_group' );
                do_settings_sections( 'symbiose' );
                submit_button( __( 'Enregistrer les paramètres', 'symbiose' ) );
                ?>
            </form>
            <hr>
            <h2><?php esc_html_e( 'Utilisation', 'symbiose' ); ?></h2>
            <p><?php esc_html_e( 'Insérez ce shortcode dans n\'importe quelle page ou article :', 'symbiose' ); ?></p>
            <code>[symbiose]</code>
        </div>
        <?php
    }
}
