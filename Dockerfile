FROM node:22

# Install required Node.js packages
RUN npm install -g @tiangong-lca/mcp-server@latest

# Expose ports
EXPOSE 80

CMD [""]
