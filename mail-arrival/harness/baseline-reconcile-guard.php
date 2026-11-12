<?php
namespace MailArrivalEvidence;

final class BaselineReconcileGuard
{
    public static function arguments(array $args): array
    {
        $url = rtrim((string) ($args['expected-app-url'] ?? ''), '/');
        $parts = parse_url($url);
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
            throw new \RuntimeException('ARGUMENTS_INVALID');
        }
        foreach (['user', 'pass', 'query', 'fragment'] as $key) {
            if (isset($parts[$key])) {
                throw new \RuntimeException('ARGUMENTS_INVALID');
            }
        }
        foreach (['config-sha256', 'inventory-sha256'] as $key) {
            if (!preg_match('/^[a-f0-9]{64}$/', (string) ($args[$key] ?? ''))) {
                throw new \RuntimeException('ARGUMENTS_INVALID');
            }
        }
        foreach (['gate-closed-confirmed', 'all-mailboxes-paused-confirmed', 'host-locks-drained-confirmed'] as $key) {
            if (!array_key_exists($key, $args)) {
                throw new \RuntimeException('OWNERSHIP_BARRIER_NOT_CONFIRMED');
            }
        }
        return ['app_url' => $url];
    }

    public static function privateBytes($path, $hash, $base = '/data/mail-arrival'): string
    {
        $base = realpath($base);
        $real = realpath($path);
        if (!$base || !$real || $real !== $path || strpos($real, $base . '/') !== 0 ||
            !is_file($real) || !function_exists('posix_geteuid')) {
            throw new \RuntimeException('PRIVATE_FILE_PATH_INVALID');
        }
        $stat = stat($real);
        if (($stat['mode'] & 0777) !== 0600 || (int) $stat['uid'] !== posix_geteuid()) {
            throw new \RuntimeException('PRIVATE_FILE_PERMISSIONS_INVALID');
        }
        if ($stat['size'] > 16 * 1024 * 1024) {
            throw new \RuntimeException('PRIVATE_FILE_TOO_LARGE');
        }
        $bytes = file_get_contents($real);
        if ($bytes === false || !hash_equals($hash, hash('sha256', $bytes))) {
            throw new \RuntimeException('PRIVATE_FILE_HASH_MISMATCH');
        }
        return $bytes;
    }

    public static function paused(array $config): void
    {
        $directory = rtrim($config['pause_dir'] ?? '/data', '/');
        foreach ([1, 2, 3] as $id) {
            if (!is_file($directory . '/mailbox-' . $id . '-sync.paused')) {
                throw new \RuntimeException('MAILBOX_NOT_PAUSED');
            }
        }
    }

    public static function scope(array $config, array $plan): array
    {
        $folders = [];
        foreach ([1, 2, 3] as $id) {
            $options = $config['mailboxes'][$id] ?? [];
            if (($options['initial_since'] ?? null) !== ($plan['floor_since_utc'] ?? null) ||
                !is_array($options['folders'] ?? null) || !$options['folders']) {
                throw new \RuntimeException('PRIVATE_CONFIG_PLAN_MISMATCH');
            }
            $folders[$id] = $options['folders'];
        }
        return $folders;
    }
}
