FROM alpine:latest

RUN apk add --no-cache krb5-server krb5 bash

COPY krb5.conf /etc/krb5.conf
COPY init_kdc.sh /init_kdc.sh

RUN chmod +x /init_kdc.sh

EXPOSE 88

CMD ["/init_kdc.sh"]
