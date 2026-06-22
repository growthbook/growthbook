FROM trinodb/trino:460

COPY --chown=trino:trino etc /etc/trino
COPY --chown=trino:trino entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
