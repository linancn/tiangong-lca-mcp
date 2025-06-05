# TianGong-AI-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong AI Model Context Protocol (MCP) Server supports STDIO, SSE and StreamableHttp protocols.

## Starting MCP Server

### Client STDIO Server

```bash
npm install -g @tiangong-lca/mcp-server

npx dotenv -e .env -- \
npx -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio
```

### Remote SSE Server

```bash
npm install -g @tiangong-lca/mcp-server
npm install -g supergateway

npx dotenv -e .env -- \
npx -y supergateway \
    --stdio "npx -y -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio" \
    --port 3001 \
    --ssePath /sse --messagePath /message
```

### Using Docker

```bash
# Build MCP server image using Dockerfile (optional)
docker build -t linancn/tiangong-lca-mcp-server:0.0.5 .

# Pull MCP server image
docker pull linancn/tiangong-lca-mcp-server:0.0.5

# Start MCP server using Docker
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.0.5
```

## Development

### Environment Setup

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 22
nvm use

# Install dependencies
npm install

# Update dependencies
npm update && npm ci
```

### Code Formatting

```bash
# Format code using the linter
npm run lint
```

### Local Testing

#### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
npm start
```

#### SSE Server

```bash
# Build and package the project
npm run build && npm pack

# Optionally, install supergateway globally
npm install -g supergateway

# Launch the SSE Server (If the parameter --baseUrl is configured, it should be set to a valid IP address or domain name)
npx dotenv -e .env -- \
npx -y supergateway \
    --stdio "npx -y -p tiangong-lca-mcp-server-0.0.5.tgz tiangong-lca-mcp-stdio" \
    --port 3001 \
    --ssePath /sse \
    --messagePath /message

# Launch MCP Inspector
npx @modelcontextprotocol/inspector
```

### Publishing

```bash
npm login

npm run build && npm publish
```

### scaffold

```bash
npx tsx src/tools/openlca_ipc_test.ts
```
