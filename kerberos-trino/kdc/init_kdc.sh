#!/bin/bash
set -e

# Initialize the Kerberos database
kdb5_util create -s -P password

# Create principals
kadmin.local -q "addprinc -pw password trino/trino.docker.internal"
kadmin.local -q "addprinc -pw password growthbook"

# Create keytabs directory if it doesn't exist
mkdir -p /keytabs
rm -f /keytabs/*.keytab

# Export keytabs
kadmin.local -q "ktadd -k /keytabs/trino.keytab trino/trino.docker.internal"
kadmin.local -q "ktadd -k /keytabs/growthbook.keytab growthbook"

# Make keytabs readable
chmod 644 /keytabs/*.keytab

echo "Kerberos KDC database and keytabs initialized"

# Function to handle signals
cleanup() {
    echo "Shutting down KDC..."
    kill $KDC_PID 2>/dev/null
    exit 0
}

trap cleanup SIGTERM SIGINT

# Start the KDC in the background (without -n flag so it daemonizes)
krb5kdc
sleep 2

# Generate a fresh TGT for growthbook user
# This ensures the credential cache is always fresh on startup
mkdir -p /etc/kerberos/tgt
rm -f /etc/kerberos/tgt/krb5cc
kinit -kt /keytabs/growthbook.keytab growthbook@TEST.LOCAL
cp /tmp/krb5cc_0 /etc/kerberos/tgt/krb5cc
chmod 644 /etc/kerberos/tgt/krb5cc

echo "Fresh TGT generated for growthbook@TEST.LOCAL"
echo "KDC is ready and running"

# Keep the container alive by running an infinite loop
# The KDC runs as a daemon in the background
while true; do
    sleep 3600
done
