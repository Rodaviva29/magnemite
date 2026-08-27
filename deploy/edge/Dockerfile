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

# Fail the build rather than the deploy: a Caddyfile that does not parse should
# never reach a running container.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
