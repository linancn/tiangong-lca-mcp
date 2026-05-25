FROM node:24-alpine

RUN npm install -g @tiangong-lca/mcp-server@0.0.30

EXPOSE 80

CMD ["tiangong-lca-mcp-http"]
