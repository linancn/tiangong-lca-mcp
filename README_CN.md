# TianGong-LCA-MCP

[中文](https://github.com/linancn/tiangong-lca-mcp/blob/main/README_CN.md) | [English](https://github.com/linancn/tiangong-lca-mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server 支持 STDIO、 SSE 和 StreamableHttp 三种协议。

## 启动 MCP 服务器

### 客户端 STDIO 服务器

```bash
npm install -g @tiangong-lca/mcp-server

npx dotenv -e .env -- \
npx -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio
```

### 远程 SSE 服务器

```bash
npm install -g @tiangong-lca/mcp-server
npm install -g supergateway

npx dotenv -e .env -- \
npx -y supergateway \
    --stdio "npx -y -p @tiangong-lca/mcp-server tiangong-lca-mcp-stdio" \
    --port 3001 \
    --ssePath /sse --messagePath /message
```

### 使用 Docker

```bash
# 使用 Dockerfile 构建 MCP 服务器镜像（可选）
docker build -t linancn/tiangong-lca-mcp-server:0.0.5 .

# 拉取 MCP 服务器镜像
docker pull linancn/tiangong-lca-mcp-server:0.0.5

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.0.5
```

## 开发

### 环境设置

```bash
# 安装 Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 22
nvm use

# 安装依赖
npm install

# 更新依赖
npm update && npm ci
```

### 代码格式化

```bash
# 使用代码检查工具格式化代码
npm run lint
```

### 本地测试

#### STDIO 服务器

```bash
# 使用 MCP Inspector 启动 STDIO 服务器
npm start
```

#### SSE 服务器

```bash
# 打包当前项目
npm run build && npm pack

# 启动 SSE 服务器，如配置了参数 --baseUrl ，应设置为有效的 IP 地址或域名
npx dotenv -e .env -- \
npx -y supergateway \
    --stdio "npx -y -p tiangong-lca-mcp-server-0.0.5.tgz tiangong-lca-mcp-stdio" \
    --port 3001 \
    --ssePath /sse \
    --messagePath /message

# 启动 MCP Inspector
npx @modelcontextprotocol/inspector
```

### 发布

```bash
npm login

npm run build && npm publish
```

### 测试脚手架

```bash
npx tsx src/tools/openlca_ipc_test.ts
```
