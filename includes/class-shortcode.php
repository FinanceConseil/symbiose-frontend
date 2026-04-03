<?php
defined( 'ABSPATH' ) || exit;

/**
 * Shortcode [symbiose]
 * Vérifie les droits, génère le JWT et affiche l'interface de chat.
 */
class Symbiose_Shortcode {

    public function __construct() {
        add_shortcode( 'symbiose', [ $this, 'render' ] );
        // Doit être enregistré tôt (pas depuis le shortcode) pour que le filtre
        // soit actif quand WordPress génère les balises <script> en footer.
        add_filter( 'script_loader_tag', [ $this, 'set_module_type' ], 10, 2 );
        add_action( 'send_headers', [ $this, 'send_chat_csp_header' ] );
    }

    /**
     * Ajoute type="module" sur le script principal du chat.
     * Supprime d'abord type="text/javascript" si WordPress l'a déjà injecté.
     */
    public function set_module_type( string $tag, string $handle ): string {
        if ( 'symbiose-chat' !== $handle ) {
            return $tag;
        }
        $tag = preg_replace( '/\s+type=["\']text\/javascript["\']/i', '', $tag );
        return str_replace( '<script ', '<script type="module" ', $tag );
    }

    // ── Rendu du shortcode ───────────────────────────────────────────────────

    public function render( array $atts = [] ): string {
        // Utilisateur non connecté
        if ( ! is_user_logged_in() ) {
            return '<div class="symbiose-notice symbiose-notice--auth">'
                . esc_html__( 'Connectez-vous pour accéder à Symbiose.', 'symbiose' )
                . '</div>';
        }

        // Rôle non autorisé
        if ( ! $this->is_user_allowed() ) {
            return '<div class="symbiose-notice symbiose-notice--auth">'
                . esc_html__( 'Vous n\'avez pas accès à cette fonctionnalité.', 'symbiose' )
                . '</div>';
        }

        // Clé secrète manquante
        $secret = (string) get_option( 'symbiose_jwt_secret', '' );
        if ( empty( $secret ) ) {
            if ( current_user_can( 'manage_options' ) ) {
                return '<div class="symbiose-notice symbiose-notice--warning">'
                    . sprintf(
                        /* translators: %s: lien vers la page admin */
                        esc_html__( 'Symbiose : veuillez configurer le JWT Secret dans %s.', 'symbiose' ),
                        '<a href="' . esc_url( admin_url( 'options-general.php?page=symbiose' ) ) . '">'
                            . esc_html__( 'les paramètres', 'symbiose' )
                        . '</a>'
                    )
                    . '</div>';
            }
            return '';
        }

        $this->enqueue_assets();

        $jwt         = $this->generate_jwt( $secret );
        $backend_url = $this->get_backend_url();

        return $this->html_template( $jwt, $backend_url );
    }

    // ── Assets ───────────────────────────────────────────────────────────────

    private function enqueue_assets(): void {
        wp_enqueue_style(
            'symbiose-chat',
            SYMBIOSE_PLUGIN_URL . 'assets/chat.css',
            [],
            SYMBIOSE_VERSION
        );

        wp_enqueue_script(
            'symbiose-marked',
            SYMBIOSE_PLUGIN_URL . 'assets/marked.min.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-mermaid',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/mermaid/mermaid.min.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-html2canvas',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/html2canvas/html2canvas.min.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-jspdf',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/jspdf/jspdf.umd.min.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-html-docx',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/html-docx-js/html-docx.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_style(
            'symbiose-katex',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/katex/katex.min.css',
            [],
            SYMBIOSE_VERSION
        );

        wp_enqueue_script(
            'symbiose-katex',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/katex/katex.min.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-katex-autorender',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/katex/auto-render.min.js',
            [ 'symbiose-katex' ],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-dompurify',
            SYMBIOSE_PLUGIN_URL . 'assets/vendor/dompurify/purify.min.js',
            [],
            SYMBIOSE_VERSION,
            true
        );

        wp_enqueue_script(
            'symbiose-chat',
            SYMBIOSE_PLUGIN_URL . 'assets/chat.js',
            [ 'symbiose-marked', 'symbiose-mermaid', 'symbiose-html2canvas', 'symbiose-jspdf', 'symbiose-html-docx', 'symbiose-katex-autorender', 'symbiose-dompurify' ],
            SYMBIOSE_VERSION,
            true
        );
    }

    // ── JWT ──────────────────────────────────────────────────────────────────

    private function generate_jwt( string $secret ): string {
        $user = wp_get_current_user();

        $roles = array_values( array_map( 'strval', (array) $user->roles ) );

        return Symbiose_JWT::encode(
            [
                'wp_user_id'   => $user->ID,
                'wp_roles'     => $roles,
                'display_name' => $user->display_name,
                'email'        => $user->user_email,
                'is_admin'     => current_user_can( 'manage_options' ),
                'aud'          => symbiose_get_jwt_audience(),
            ],
            $secret,
            3600
        );
    }

    // ── Autorisation ─────────────────────────────────────────────────────────

    private function is_user_allowed(): bool {
        $allowed_roles = (array) get_option( 'symbiose_allowed_roles', [ 'administrator' ] );

        if ( empty( $allowed_roles ) ) {
            return false;
        }

        $user       = wp_get_current_user();
        $user_roles = (array) $user->roles;

        return ! empty( array_intersect( $user_roles, $allowed_roles ) );
    }

    private function get_backend_url(): string {
        return rtrim( (string) get_option( 'symbiose_backend_url', 'http://localhost:3000' ), '/' );
    }

    public function send_chat_csp_header(): void {
        if ( headers_sent() || ! $this->is_chat_page() ) {
            return;
        }

        header( 'Content-Security-Policy: ' . $this->build_chat_csp_policy() );
    }

    private function is_chat_page(): bool {
        if ( is_admin() ) {
            return false;
        }

        $post = get_queried_object();
        if ( ! $post instanceof WP_Post ) {
            return false;
        }

        $content = (string) $post->post_content;
        return $content && has_shortcode( $content, 'symbiose' );
    }

    private function build_chat_csp_policy(): string {
        $backend_url = $this->get_backend_url();
        $connect_src = [ "'self'" ];

        $backend_parts = wp_parse_url( $backend_url );
        if ( ! empty( $backend_parts['scheme'] ) && ! empty( $backend_parts['host'] ) ) {
            $backend_origin = $backend_parts['scheme'] . '://' . $backend_parts['host'];
            if ( ! empty( $backend_parts['port'] ) ) {
                $backend_origin .= ':' . (int) $backend_parts['port'];
            }
            $connect_src[] = $backend_origin;
        }

        $directives = [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            'connect-src ' . implode( ' ', array_unique( $connect_src ) ),
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'self'",
        ];

        return implode( '; ', $directives );
    }

    // ── Template HTML ────────────────────────────────────────────────────────

    private function html_template( string $jwt, string $backend_url ): string {
        ob_start();
        require SYMBIOSE_PLUGIN_DIR . 'includes/views/chat-template.php';
        return ob_get_clean();
    }
}
