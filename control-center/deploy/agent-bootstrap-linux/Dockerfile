ARG BASE_IMAGE=debian:12-slim
FROM ${BASE_IMAGE}

ENV container=docker
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nodejs openssl procps systemd systemd-sysv tar util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY fake-control-center.mjs /usr/local/lib/opsworkbench-bootstrap-fixture/fake-control-center.mjs
COPY prepare-fixture.sh /usr/local/lib/opsworkbench-bootstrap-fixture/prepare-fixture.sh
RUN chmod 0755 /usr/local/lib/opsworkbench-bootstrap-fixture/prepare-fixture.sh

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
