#!/usr/bin/env bash
set -euo pipefail
# Run on the Linux application host. Does not restart or modify the database.
image=$(docker inspect heatsinkrep-db-1 --format '{{.Config.Image}}')
version=$(docker exec heatsinkrep-db-1 rpm -q --qf '%{VERSION}-%{RELEASE}.%{ARCH}' mysql-community-server-minimal)
[[ "$version" =~ ^8\.4\.[0-9]+-[0-9]+\.el9\.x86_64$ ]]
work=$(mktemp -d /tmp/heatsink-backup-client.XXXXXX)
trap 'rm -rf "$work"' EXIT
curl --fail --location --connect-timeout 15 --max-time 120 --retry 2 \
  "https://repo.mysql.com/yum/mysql-8.4-community/el/9/x86_64/mysql-community-client-${version}.rpm" -o "$work/client.rpm"
curl --fail --location --connect-timeout 15 --max-time 30 \
  https://repo.mysql.com/RPM-GPG-KEY-mysql-2025 -o "$work/mysql-signing-key"
docker run --rm --network none -v "$work:/package:ro" --entrypoint sh "$image" -c \
  'rpmkeys --import /package/mysql-signing-key && rpmkeys --checksig --verbose /package/client.rpm'
docker run --rm --network none -v "$work:/package:ro" --entrypoint rpm2cpio "$image" /package/client.rpm > "$work/client.cpio"
(cd "$work" && cpio -id ./usr/bin/mysqlbinlog < client.cpio)
cp "$work/usr/bin/mysqlbinlog" "$work/mysqlbinlog"
cp "$(dirname "$0")/Dockerfile" "$work/Dockerfile"
printf "*\n!Dockerfile\n!mysqlbinlog\n" > "$work/.dockerignore"
docker build --build-arg "MYSQL_IMAGE=$image" -t heatsinkrep-backup-client:8.4 "$work"
docker image inspect heatsinkrep-backup-client:8.4 --format '{{.Id}}' > /opt/heatsinkrep/backup-client-image
chmod 600 /opt/heatsinkrep/backup-client-image
