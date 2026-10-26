# SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
# SPDX-License-Identifier: Apache-2.0
#
# AIGC VisionSense server image (server, web UI and device transports in one container).
# Build from the visionsense/ directory:
#   docker build -f deploy/Dockerfile -t aigc/visionsense:4.3.1.7 .
# To package an already built jar instead of compiling (faster, e.g. in CI after `mvn install`):
#   docker build -f deploy/Dockerfile --build-arg JAR_SOURCE=prebuilt -t aigc/visionsense:4.3.1.7 .
# which expects the jar at deploy/thingsboard.jar.

ARG JAR_SOURCE=build

# --- Compile server and UI. Needs Maven Central, npm and repo.thingsboard.io. ---
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -ntp install -pl application -am -DskipTests -Dlicense.skip=true \
 && cp application/target/thingsboard-*-boot.jar /thingsboard.jar

FROM scratch AS prebuilt
COPY deploy/thingsboard.jar /thingsboard.jar

FROM ${JAR_SOURCE} AS jar

# --- Runtime: the official ThingsBoard 4.3.1.7 node image with the VisionSense build swapped in. ---
FROM thingsboard/tb-node:4.3.1.7
COPY --from=jar --chown=thingsboard:thingsboard --chmod=555 /thingsboard.jar /usr/share/thingsboard/bin/thingsboard.jar
COPY --chown=thingsboard:thingsboard application/src/main/resources/templates/ /usr/share/thingsboard/conf/templates/
LABEL org.opencontainers.image.title="AIGC VisionSense" \
      org.opencontainers.image.description="Smart construction monitoring platform based on ThingsBoard CE 4.3.1.7" \
      org.opencontainers.image.licenses="Apache-2.0"
EXPOSE 8080 1883 5683/udp 7070
# The base image has no curl/wget; Perl is available.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=20 \
  CMD ["perl", "-MIO::Socket::INET", "-e", "my $s = IO::Socket::INET->new(PeerAddr => 'localhost:8080', Timeout => 3) or exit 1; print $s \"GET /login HTTP/1.0\\r\\n\\r\\n\"; my $l = <$s>; exit(($l // '') =~ m{ 200 } ? 0 : 1)"]
CMD ["start-tb-node.sh"]
