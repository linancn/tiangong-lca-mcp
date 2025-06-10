FROM node:22-alpine

RUN npm install -g @tiangong-lca/mcp-server@latest

EXPOSE 9278

CMD ["tiangong-lca-mcp-http"]
