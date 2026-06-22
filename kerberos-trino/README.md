# Kerberos Trino Test Environment

This directory contains a Docker-based test environment for Trino with Kerberos authentication.

## Services

- **KDC**: Kerberos Key Distribution Center (Realm: `TEST.LOCAL`)
- **Trino**: Trino coordinator/worker configured with Kerberos
- **GrowthBook**: GrowthBook app (development build)

## Getting Started

1.  Start the services:

    ```bash
    docker-compose up -d
    ```

2.  Services will be available at:
    - **Trino**: `https://localhost:8443` (HTTPS required for Kerberos)
    - **GrowthBook**: `http://localhost:3101` (Mapped from container port 3000)

## Kerberos Details

- **Realm**: `TEST.LOCAL`
- **KDC Host**: `kdc.docker.internal`
- **Trino Principal**: `trino/trino.docker.internal@TEST.LOCAL`
- **Client Principal**: `growthbook@TEST.LOCAL`

### Keytabs

Keytabs are generated automatically on startup and shared via a Docker volume. They are mounted at `/keytabs` in all containers.

- `trino.keytab`: Used by Trino service.
- `growthbook.keytab`: For client authentication.

## Connecting from GrowthBook

In the GrowthBook data source configuration:

1.  **Type**: Trino
2.  **Host**: `trino.docker.internal`
3.  **Port**: `8443`
4.  **Protocol**: `https`
5.  **Authentication**: Kerberos
6.  **Service Principal**: `trino/trino.docker.internal@TEST.LOCAL`
7.  **Client Principal**: `growthbook@TEST.LOCAL`
8.  **Keytab Path**: `/keytabs/growthbook.keytab`
9.  **KDC Host**: `kdc.docker.internal`
10. **Realm**: `TEST.LOCAL`

## Debugging

### Verify Kerberos auth

The GrowthBook container is distroless (no shell). Scripts must run from the
mounted `/app/kerberos-trino` directory where `node_modules` lives. Do not copy
scripts into `/usr/local/src/app`; Node will not resolve `kerberos` there.

First install script dependencies on the host (once):

```bash
npm install
```

Then run the full auth check (401 without token, 200 with valid token, 401 on reuse):

```bash
docker exec kerberos-trino-growthbook-1 node /app/kerberos-trino/verify_trino.js
```

Or from the host via npm:

```bash
npm run verify
# runs locally; requires trino.docker.internal to resolve (use docker exec above instead)
```

### Logs and keytabs

To check logs:

```bash
docker-compose logs -f
```

To inspect keytabs:

```bash
docker-compose exec kdc ls -l /keytabs
```
