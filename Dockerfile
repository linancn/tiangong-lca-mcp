FROM node:22-alpine

RUN npm install -g @tiangong-lca/mcp-server@0.0.6

EXPOSE 9278

CMD ["tiangong-lca-mcp-http"]
