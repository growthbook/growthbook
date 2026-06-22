#!/bin/bash
set -e

echo "Waiting for keytab at /keytabs/trino.keytab..."
while [ ! -f /keytabs/trino.keytab ]; do
  sleep 2
done

echo "Keytab found! Starting Trino..."
exec /usr/lib/trino/bin/launcher run --etc-dir /etc/trino
