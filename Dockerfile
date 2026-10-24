FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile
ARG CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL
RUN pnpm run build:render
ENV NODE_ENV=production
CMD ["node", "deployment/start.mjs"]
