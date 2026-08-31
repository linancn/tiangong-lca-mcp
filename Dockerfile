FROM node:24.19.0-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack install --global pnpm@11.24.0 \
    && pnpm add --global @tiangong-lca/mcp-server@0.1.1

EXPOSE 80

CMD ["tiangong-lca-mcp-http"]
