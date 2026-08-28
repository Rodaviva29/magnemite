# The edge, with its config baked in.
#
# The Caddyfile used to be a bind mount, which is fine locally and a trap on
# Coolify: it turns a file bind mount into a mount it manages itself, so the
# copy that ends up in the container is the one stored on the server rather
# than the one in the repository. Editing the Caddyfile here changed nothing
# until someone edited it there too.
#
# Baked into an image, the deploy that rebuilds is the deploy that ships the
# routes, and the repository is the only place this is written.
FROM caddy:2-alpine

# Which config this image carries: `Caddyfile` fronts the whole stack on a
# plain VPS, `Caddyfile.coolify` sits behind Coolify's proxy and serves only
# what the boxes need.
ARG CADDYFILE=Caddyfile
COPY ${CADDYFILE} /etc/caddy/Caddyfile

# Metadata only: both Caddyfiles hardcode :8080, and Caddy reads neither of
# these. They are here for whoever inspects the image -- Coolify among them,
# which guesses a service's port off exactly this when it generates a domain.
#
# EXPOSE adds to the inherited claim rather than replacing it: caddy:2-alpine
# already exposes 80, 443 and 2019, none of which anything here opens, and a
# child image cannot take those back.
#
# PORT is deliberately not wired into the Caddyfile. Hanging the listener off
# an environment variable means anything that sets PORT in this container --
# Coolify does, for some resource types -- moves Caddy while the healthcheck
# and the proxy still say 8080, which is a 502 for the whole fleet.
ENV PORT=8080
EXPOSE 8080

# Fail the build rather than the deploy: a Caddyfile that does not parse should
# never reach a running container.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
