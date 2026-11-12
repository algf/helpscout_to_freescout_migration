<?php
namespace Modules\MailArrival;

/** Explicit deployment pins. Activating the module never enables importing. */
final class DeploymentGuard
{
    public static function identities()
    {
        $identities = config(
            self::local()
                ? 'mail_arrival.mailbox_identities'
                : 'mail_arrival.production.mailboxes',
            []
        );
        return is_array($identities) ? $identities : [];
    }

    public static function local()
    {
        return in_array(
            parse_url(config('app.url'), PHP_URL_HOST),
            ['localhost', '127.0.0.1'],
            true
        );
    }

    public static function allowed()
    {
        if (self::local()) {
            return true;
        }
        $pin = config('mail_arrival.production.app_url');
        if (
            config('mail_arrival.production.enabled', false) !== true ||
            !is_string($pin) ||
            !$pin ||
            rtrim(config('app.url'), '/') !== rtrim($pin, '/') ||
            parse_url($pin, PHP_URL_SCHEME) !== 'https' ||
            !parse_url($pin, PHP_URL_HOST)
        ) {
            return false;
        }
        $parts = parse_url($pin);
        foreach (['user', 'pass', 'query', 'fragment'] as $part) {
            if (isset($parts[$part])) {
                return false;
            }
        }
        $pins = config('mail_arrival.production.mailboxes', []);
        if (!is_array($pins) || count($pins) !== 3) {
            return false;
        }
        foreach ([1, 2, 3] as $id) {
            if (
                !is_string($pins[$id] ?? null) ||
                !filter_var($pins[$id], FILTER_VALIDATE_EMAIL)
            ) {
                return false;
            }
            // Production always uses saved native mailbox credentials.
            if (
                config('mail_arrival.fixture_scope.' . $id) ||
                config('mail_arrival.clients.' . $id)
            ) {
                return false;
            }
        }
        return true;
    }

    public static function fixtureScope($id)
    {
        $scope = config('mail_arrival.fixture_scope.' . (int) $id, []);
        if (!$scope) {
            return [];
        }
        if (!self::local() || !is_array($scope)) {
            throw new \RuntimeException('Fixture scope requires local deployment');
        }
        return $scope;
    }

    public static function matches($mailbox)
    {
        $id = (int) $mailbox->id;
        $expected = self::identities();
        $scope = self::fixtureScope($id);
        $email = $scope['email'] ?? ($expected[$id] ?? '');
        return in_array($id, [1, 2, 3], true) &&
            is_string($email) && $email !== '' &&
            strtolower($mailbox->email) === strtolower($email);
    }

    public static function assertInstall()
    {
        if (PHP_SAPI !== 'cli' || !self::allowed()) {
            throw new \RuntimeException('Installer requires approved CLI deployment');
        }
        if (!self::local()) {
            foreach (self::identities() as $id => $email) {
                if (!self::matches(\App\Mailbox::findOrFail($id))) {
                    throw new \RuntimeException('Mailbox identity mismatch');
                }
            }
        }
    }
}
