FROM node:22-alpine

RUN npm install -g @tiangong-lca/mcp-server@0.0.16

EXPOSE 80

CMD ["tiangong-lca-mcp-http"]
