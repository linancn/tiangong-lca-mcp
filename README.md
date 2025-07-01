# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server supports STDIO, SSE, and Streamable Http protocols.

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

## Local Testing

### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
npm start
```

### SSE Server

```bash
# Build and package the project
npm run build && npm pack

# Launch the SSE Server (If the parameter --baseUrl is configured, it should be set to a valid IP address or domain name)
npx dotenv -e .env -- \
npx -y supergateway \
    --stdio "npx -y -p tiangong-lca-mcp-server-0.0.5.tgz tiangong-lca-mcp-stdio" \
    --port 3001 \
    --ssePath /sse \
    --messagePath /message
```

### Streamable Http Server

```bash
npm run start:server
```

### Launch MCP Inspector

```bash
npx @modelcontextprotocol/inspector
