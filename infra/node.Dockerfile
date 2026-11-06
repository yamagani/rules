# Builds the JS workspace once; compose runs a different command per service.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_REMOTE_RULES_URL=http://localhost:5174
ARG VITE_REMOTE_RELEASES_URL=http://localhost:5175
ARG VITE_REMOTE_ADMIN_URL=http://localhost:5176
ENV VITE_REMOTE_RULES_URL=$VITE_REMOTE_RULES_URL VITE_REMOTE_RELEASES_URL=$VITE_REMOTE_RELEASES_URL VITE_REMOTE_ADMIN_URL=$VITE_REMOTE_ADMIN_URL
RUN pnpm build
