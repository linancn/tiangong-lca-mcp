FROM node:22-alpine

RUN npm install -g @tiangong-lca/mcp-server@0.0.19

EXPOSE 80

CMD ["tiangong-lca-mcp-http"]
