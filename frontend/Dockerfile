# syntax=docker/dockerfile:1.7

FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM deps AS build
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-frame-protection.conf /etc/nginx/snippets/frame-protection.conf
# Widened framing headers for the framable /embed/ and /share/ pages: the map
# template is rendered with envsubst at start (the filter limits it to the
# EMBED_FRAME_* vars) into /etc/nginx/snippets/, after the .envsh below has
# validated EMBED_FRAME_ANCESTORS into EMBED_FRAME_ANCESTORS_SAFE (fail closed
# to 'self'); the template reads only the _SAFE value. The defaults here are the
# same disabled state, so an unset variable can never leave a literal
# "${...}" in a header.
COPY nginx-frame-protection-embed.conf /etc/nginx/snippets/frame-protection-embed.conf
COPY nginx-frame-protection-embed-map.conf.template /etc/nginx/templates/frame-protection-embed-map.conf.template
COPY --chmod=755 nginx-embed-frame-ancestors.envsh /docker-entrypoint.d/15-embed-frame-ancestors.envsh
ENV NGINX_ENVSUBST_FILTER="^EMBED_FRAME_" \
    NGINX_ENVSUBST_OUTPUT_DIR="/etc/nginx/snippets" \
    EMBED_FRAME_ANCESTORS="" \
    EMBED_FRAME_ANCESTORS_SAFE="" \
    EMBED_FRAME_XFO="SAMEORIGIN"
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
