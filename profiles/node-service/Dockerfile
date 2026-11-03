# Multi-stage build — project-baseline node-service profile.
# If making any changes to this file, test building and running the kube deployment locally.
#
# Placeholders to set per repo:
#   {{PORT}}          runtime port the service listens on (e.g. 5000)
#   {{START_CMD}}     container entrypoint (e.g. ./bin/www)
# The node base image digest is kept current by Dependabot (docker ecosystem).

# --- Stage 1: builder ---
FROM node:24-trixie-slim AS builder

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# --- Stage 2: runtime ---
FROM node:24-trixie-slim

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app .

# Reduce runtime attack surface: remove npm/npx from the runtime image.
RUN rm -rf /usr/local/lib/node_modules/npm && \
	rm -f /usr/local/bin/npm /usr/local/bin/npx

# Run as a non-root user.
RUN groupadd -g 1014 app_user && useradd -rm -d /usr/src/app -u 1015 -g app_user app_user
RUN chown -R app_user:app_user /usr/src/app

USER 1015

EXPOSE {{PORT}}

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Use node directly instead of npm start to reduce runtime attack surface
# and avoid npm lifecycle-script execution in production containers.
CMD ["node", "{{START_CMD}}"]
