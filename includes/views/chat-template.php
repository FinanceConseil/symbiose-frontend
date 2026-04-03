<?php
defined( 'ABSPATH' ) || exit;
?>
<div
    id="symbiose-app"
    role="main"
    aria-label="<?php esc_attr_e( 'Symbiose', 'symbiose' ); ?>"
    data-jwt="<?php echo esc_attr( $jwt ); ?>"
    data-backend-url="<?php echo esc_attr( $backend_url ); ?>"
>

    <!-- Sidebar -->
    <div id="symbiose-sidebar-backdrop" aria-hidden="true"></div>
    <aside id="symbiose-sidebar" aria-label="<?php esc_attr_e( 'Conversations', 'symbiose' ); ?>">
        <div id="symbiose-sidebar-header">
            <span class="symbiose-sidebar-title"><?php esc_html_e( 'Conversations', 'symbiose' ); ?></span>
            <div class="symbiose-sidebar-header-actions">
                <button id="symbiose-new-conversation" title="<?php esc_attr_e( 'Nouvelle conversation', 'symbiose' ); ?>" aria-label="<?php esc_attr_e( 'Nouvelle conversation', 'symbiose' ); ?>">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button id="symbiose-sidebar-toggle" aria-label="<?php esc_attr_e( 'Fermer la sidebar', 'symbiose' ); ?>">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>
        <nav id="symbiose-conversation-list" aria-label="<?php esc_attr_e( 'Liste des conversations', 'symbiose' ); ?>">
            <p class="symbiose-list-placeholder"><?php esc_html_e( 'Chargement…', 'symbiose' ); ?></p>
        </nav>
        <div id="symbiose-sidebar-footer">
            <div id="symbiose-user-name"></div>
            <div id="symbiose-quota-bar-wrap" hidden>

                <!-- Barre budget journalier (principale) -->
                <div class="symbiose-quota-label">
                    <span><?php esc_html_e( 'Budget', 'symbiose' ); ?></span>
                    <span id="symbiose-quota-text"></span>
                </div>
                <div class="symbiose-quota-tokens-wrap">
                    <div class="symbiose-quota-track">
                        <div id="symbiose-quota-fill" class="symbiose-quota-fill"></div>
                    </div>
                    <!-- Tooltip semaine / mois (hover sur la track) -->
                    <div id="symbiose-quota-cost-tooltip"
                         class="symbiose-tooltip symbiose-tooltip--above symbiose-tooltip--right symbiose-tooltip--hover" hidden>
                        <div class="symbiose-gauge-tip-row">
                            <span class="symbiose-gauge-tip-label"><?php esc_html_e( 'Semaine', 'symbiose' ); ?></span>
                            <span class="symbiose-gauge-tip-val" id="symbiose-quota-tip-week">—</span>
                        </div>
                        <div class="symbiose-gauge-tip-row">
                            <span class="symbiose-gauge-tip-label"><?php esc_html_e( 'Mois', 'symbiose' ); ?></span>
                            <span class="symbiose-gauge-tip-val" id="symbiose-quota-tip-month">—</span>
                        </div>
                    </div>
                </div>

                <!-- Barre messages (secondaire, visible si max_messages défini) -->
                <div class="symbiose-quota-tokens-wrap">
                    <div class="symbiose-quota-label symbiose-quota-tokens-label" id="symbiose-quota-messages-label" hidden>
                        <span><?php esc_html_e( 'Messages', 'symbiose' ); ?></span>
                        <span id="symbiose-quota-messages-text"></span>
                    </div>
                    <div class="symbiose-quota-track" id="symbiose-quota-messages-track" hidden>
                        <div id="symbiose-quota-messages-fill" class="symbiose-quota-fill"></div>
                    </div>
                </div>

            </div>
        </div>
    </aside>

    <!-- Zone principale -->
    <main id="symbiose-main">

        <!-- Header -->
        <header id="symbiose-header">
            <button id="symbiose-hamburger" class="symbiose-icon-btn symbiose-icon-btn--md" aria-label="<?php esc_attr_e( 'Ouvrir la sidebar', 'symbiose' ); ?>">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div id="symbiose-agent-picker" class="symbiose-agent-picker" aria-label="<?php esc_attr_e( 'Sélectionner un agent', 'symbiose' ); ?>"></div>
            <span id="symbiose-agent-meta" hidden></span>
            <div id="symbiose-header-actions">
                <button id="symbiose-docs-btn" class="symbiose-icon-btn symbiose-icon-btn--md" hidden aria-label="<?php esc_attr_e( 'Documents de la conversation', 'symbiose' ); ?>" title="<?php esc_attr_e( 'Documents de la conversation', 'symbiose' ); ?>">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span id="symbiose-docs-count" class="symbiose-docs-count"></span>
                </button>
                <button id="symbiose-fullscreen-btn" class="symbiose-icon-btn symbiose-icon-btn--md" aria-label="<?php esc_attr_e( 'Plein écran', 'symbiose' ); ?>" title="<?php esc_attr_e( 'Plein écran', 'symbiose' ); ?>">
                    <svg id="symbiose-icon-expand" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    <svg id="symbiose-icon-compress" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
                </button>
            </div>
        </header>

        <!-- Messages -->
        <div id="symbiose-messages" role="log" aria-live="polite" aria-label="<?php esc_attr_e( 'Messages', 'symbiose' ); ?>">
            <div id="symbiose-welcome" class="symbiose-welcome">
                <p><?php esc_html_e( 'Sélectionnez un agent et posez votre question.', 'symbiose' ); ?></p>
            </div>
        </div>

        <!-- Panel documents -->
        <aside id="symbiose-docs-panel" aria-label="<?php esc_attr_e( 'Documents', 'symbiose' ); ?>">
            <div id="symbiose-docs-panel-header">
                <span id="symbiose-docs-panel-title"><?php esc_html_e( 'Documents', 'symbiose' ); ?></span>
                <button id="symbiose-docs-panel-close" class="symbiose-icon-btn symbiose-icon-btn--sm" aria-label="<?php esc_attr_e( 'Fermer', 'symbiose' ); ?>">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div id="symbiose-docs-panel-body"></div>
            <div id="symbiose-docs-panel-footer"></div>
        </aside>

        <!-- Footer / saisie -->
        <footer id="symbiose-footer">
            <div id="symbiose-upload-preview" hidden></div>
            <div id="symbiose-input-row">
                <label id="symbiose-upload-label" class="symbiose-icon-btn symbiose-icon-btn--lg" title="<?php esc_attr_e( 'Joindre des fichiers (10 Mo max par fichier)', 'symbiose' ); ?>" aria-label="<?php esc_attr_e( 'Joindre des fichiers', 'symbiose' ); ?>">
                    <input type="file" id="symbiose-file-input" accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.csv,.txt,.epub,.xml,.rtf,.odt,.jpg,.jpeg,.png,.avif,.tiff,.tif,.gif,.heic,.heif,.bmp,.webp" multiple hidden>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </label>
                <textarea
                    id="symbiose-message-input"
                    placeholder="<?php esc_attr_e( 'Votre message… (Entrée pour envoyer, Maj+Entrée pour saut de ligne)', 'symbiose' ); ?>"
                    rows="1"
                    aria-label="<?php esc_attr_e( 'Saisir un message', 'symbiose' ); ?>"
                ></textarea>
                <div id="symbiose-context-gauge" aria-label="<?php esc_attr_e( 'Utilisation du contexte', 'symbiose' ); ?>" hidden>
                    <svg viewBox="0 0 36 36" width="28" height="28" aria-hidden="true">
                        <circle class="symbiose-gauge-bg"   cx="18" cy="18" r="14"/>
                        <circle class="symbiose-gauge-sys"  cx="18" cy="18" r="14"/>
                        <circle class="symbiose-gauge-docs" cx="18" cy="18" r="14"/>
                        <circle class="symbiose-gauge-hist" cx="18" cy="18" r="14"/>
                    </svg>
                    <div id="symbiose-gauge-tooltip" class="symbiose-tooltip symbiose-tooltip--above symbiose-tooltip--right" hidden>
                        <div class="symbiose-gauge-tip-row symbiose-gauge-tip-sys">
                            <span class="symbiose-gauge-tip-dot"></span>
                            <span class="symbiose-gauge-tip-label">Système</span>
                            <span class="symbiose-gauge-tip-val" id="symbiose-gauge-tip-sys">—</span>
                        </div>
                        <div class="symbiose-gauge-tip-row symbiose-gauge-tip-docs">
                            <span class="symbiose-gauge-tip-dot"></span>
                            <span class="symbiose-gauge-tip-label">Documents</span>
                            <span class="symbiose-gauge-tip-val" id="symbiose-gauge-tip-docs">—</span>
                        </div>
                        <div class="symbiose-gauge-tip-row symbiose-gauge-tip-hist">
                            <span class="symbiose-gauge-tip-dot"></span>
                            <span class="symbiose-gauge-tip-label">Historique</span>
                            <span class="symbiose-gauge-tip-val" id="symbiose-gauge-tip-hist">—</span>
                        </div>
                        <div class="symbiose-gauge-tip-row symbiose-gauge-tip-free">
                            <span class="symbiose-gauge-tip-dot"></span>
                            <span class="symbiose-gauge-tip-label">Libre</span>
                            <span class="symbiose-gauge-tip-val" id="symbiose-gauge-tip-free">—</span>
                        </div>
                    </div>
                </div>
                <button id="symbiose-mic-btn" class="symbiose-icon-btn symbiose-icon-btn--lg" aria-label="<?php esc_attr_e( 'Dicter un message', 'symbiose' ); ?>" title="<?php esc_attr_e( 'Dicter un message', 'symbiose' ); ?>" hidden>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </button>
                <button id="symbiose-send-btn" aria-label="<?php esc_attr_e( 'Envoyer', 'symbiose' ); ?>" disabled>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
                <button id="symbiose-stop-btn" aria-label="<?php esc_attr_e( 'Arrêter la génération', 'symbiose' ); ?>" hidden>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                </button>
            </div>
        </footer>

    </main>
</div>
