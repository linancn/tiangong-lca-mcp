[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/linancn-tiangong-lca-mcp-badge.png)](https://mseep.ai/app/linancn-tiangong-lca-mcp)

# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server supports STDIO and Streamable Http protocols.

## Starting MCP Server

### Client STDIO Server

```bash
npm install -g @tiangong-lca/mcp-server

npx dotenv -e .env -- \
npx -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio
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

### Streamable Http Server

```bash
npm run start:server
```

#### Streamable Http Local Server

```bash
npm run start:server-local
```

### Launch MCP Inspector

```bash
DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector
```
