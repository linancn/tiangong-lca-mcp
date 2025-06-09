FROM node:22-alpine

RUN npm install -g @tiangong-lca/mcp-server@0.0.5

EXPOSE 9278

CMD ["npx", "-p", "@tiangong-lca-mcp-server", "tiangong-lca-mcp-http"]
