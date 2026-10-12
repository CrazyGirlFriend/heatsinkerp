# build-client.sh verifies the matching RPM signature before extracting this file.
ARG MYSQL_IMAGE
FROM ${MYSQL_IMAGE}
COPY mysqlbinlog /usr/bin/mysqlbinlog
RUN mysqlbinlog --version
