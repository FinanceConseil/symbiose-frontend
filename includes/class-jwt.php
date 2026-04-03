<?php
defined( 'ABSPATH' ) || exit;

/**
 * Générateur de JWT HS256 — pure PHP, sans dépendance externe.
 */
class Symbiose_JWT {

    /**
     * Encode un tableau en JWT signé HS256.
     *
     * @param array  $payload  Données à inclure dans le token.
     * @param string $secret   Clé secrète HMAC-SHA256 partagée avec le backend.
     * @param int    $expiry   Durée de validité en secondes (défaut : 1h).
     * @return string JWT au format header.payload.signature
     */
    public static function encode( array $payload, string $secret, int $expiry = 3600 ): string {
        $now = time();

        $payload['iat'] = $now;
        $payload['exp'] = $now + $expiry;

        $header    = self::base64url_encode( (string) json_encode( [ 'alg' => 'HS256', 'typ' => 'JWT' ] ) );
        $payload   = self::base64url_encode( (string) json_encode( $payload ) );
        $signature = self::base64url_encode(
            hash_hmac( 'sha256', $header . '.' . $payload, $secret, true )
        );

        return $header . '.' . $payload . '.' . $signature;
    }

    /**
     * Encode en base64url (RFC 4648 §5) — remplace +/= par -, _, supprime le padding.
     */
    private static function base64url_encode( string $data ): string {
        return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
    }
}
