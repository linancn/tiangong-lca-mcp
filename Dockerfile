FROM node:22-alpine

RUN npm install -g @tiangong-lca/mcp-server@latest

EXPOSE 9278

CMD ["npx", "-p", "tiangong-lca-mcp-server" "tiangong-lca-mcp-http"]
