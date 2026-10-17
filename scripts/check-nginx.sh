#!/bin/sh
# Test the nginx configuration in deploy/nginx with a throwaway certificate.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/tls" "$work/cache" "$work/www"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=aspa.test" \
  -keyout "$work/tls/key.pem" -out "$work/tls/fullchain.pem" 2>/dev/null
cp -R "$root/site/." "$work/www/"

# Point the production paths at the temporary directory and listen on loopback
# using unprivileged ports (nginx -t also tries to bind the sockets).
sed -e "s|/usr/local/etc/nginx/tls|$work/tls|g" \
    -e "s|/usr/local/www/aspa|$work/www|g" \
    -e "s|/usr/local/etc/nginx/rpki-proxy.conf|$root/deploy/nginx/rpki-proxy.conf|g" \
    -e "s|/usr/local/etc/nginx/security-headers.conf|$root/deploy/nginx/security-headers.conf|g" \
    -e "s|/var/cache/nginx/aspa|$work/cache|g" \
    -e "s|/var/db/aspa-gen/adoption.json|$work/gen/adoption.json|g" \
    -e "s|/var/db/aspa-gen/asn-registry.json|$work/gen/asn-registry.json|g" \
    -e "s|/var/db/aspa-gen/leaks.json|$work/gen/leaks.json|g" \
    -e "s|/var/db/aspa-gen/validators.json|$work/gen/validators.json|g" \
    -e "s|/var/db/aspa-gen/current|$work/gen|g" \
    -e "s|192\.0\.2\.10|127.0.0.1|g" \
    -e "s|127\.0\.0\.1:8080;|127.0.0.1:18080;|" \
    -e "s|listen 127\.0\.0\.1:80;|listen 127.0.0.1:18081;|" \
    -e "s|listen 127\.0\.0\.1:443 ssl;|listen 127.0.0.1:18443 ssl;|" \
    "$root/deploy/nginx/aspa.conf" > "$work/aspa.conf"

cat > "$work/nginx.conf" <<CONF
pid $work/nginx.pid;
error_log $work/error.log;
events {}
http {
  access_log off;
  include $work/aspa.conf;
}
CONF

nginx -t -c "$work/nginx.conf" -e "$work/error.log"
