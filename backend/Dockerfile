# --- build stage ---
# Pull Node from ECR Public (AWS-hosted Docker Hub mirror) to avoid
# docker.io anonymous pull rate limits in CodeBuild.
FROM public.ecr.aws/docker/library/node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY drizzle.config.ts ./
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev

# --- runtime stage ---
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
CMD ["dist/index.js"]
