# Amazon Cognito OAuth 配置指南

本文档说明如何配置项目以使用 Amazon Cognito 进行 OAuth 认证。

## 配置概览

项目已更新为支持 Amazon Cognito 认证，包含以下主要更改：

### 1. 环境变量配置

在您的 `.env` 文件中添加以下 Cognito 配置：

```bash
# Amazon Cognito Configuration
COGNITO_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_SnSYiMoND
COGNITO_CLIENT_ID=3p182unuqch7rahbp0trs1sprv
```

### 2. OAuth 端点

系统现在配置为使用以下 Cognito OAuth 端点：

- **Authorization URL**: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SnSYiMoND/oauth2/authorize`
- **Token URL**: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SnSYiMoND/oauth2/token`
- **Revocation URL**: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SnSYiMoND/oauth2/revoke`
- **JWKS URL**: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SnSYiMoND/.well-known/jwks.json`

### 3. 认证方式

系统支持两种认证方式：

#### 3.1 Bearer Token 认证

客户端在请求头中包含 JWT access token：

```http
Authorization: Bearer <your-cognito-jwt-token>
```

#### 3.2 OAuth 流程

通过标准 OAuth 2.0 授权码流程进行认证。

### 4. 主要功能

- **JWT 验证**: 使用 `aws-jwt-verify` 库验证 Cognito JWT token
- **Redis 缓存**: 缓存已验证的用户信息以提高性能
- **自动过期**: 缓存项自动在 1 小时后过期

### 5. API 端点

- **POST /mcp**: 主要的 MCP 端点（需要 Bearer 认证）
- **GET /health**: 健康检查端点（无需认证）
- **OAuth 路由**: `/oauth/*` - OAuth 相关端点

### 6. 在 Cognito 中的设置要求

确保您的 Cognito App Client 配置如下：

1. **App client settings**:
   - Enable Identity Provider (如 Cognito User Pool)
   - 回调 URL: `http://localhost:3000/callback` (或您的实际回调 URL)
   - Sign out URL: 根据需要配置
   - OAuth Flow: Authorization code grant
   - OAuth Scopes: `openid`, `email`, `profile`

2. **Domain name**: 为 App client 配置域名以使用 hosted UI

### 7. 使用示例

#### 获取 Access Token

```javascript
// 使用 AWS SDK 或 Cognito hosted UI 获取 token
const response = await fetch('YOUR_COGNITO_DOMAIN/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: 'your-client-id',
    code: 'authorization-code-from-callback',
    redirect_uri: 'http://localhost:3000/callback',
  }),
});
```

#### 使用 Token 调用 API

```javascript
const response = await fetch('https://mcp.tiangong.world/mcp', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    // MCP request body
  }),
});
```

### 8. 故障排除

1. **Token 验证失败**: 检查 token 是否过期，确保使用正确的 User Pool ID 和 Client ID
2. **缓存问题**: Redis 配置是否正确
3. **CORS 问题**: 可能需要配置 CORS 设置用于前端应用

### 9. 迁移注意事项

- 旧的 Supabase 认证代码仍然保留，您可以选择保留或移除
- 确保更新客户端代码以使用新的认证方式
- 更新部署配置以包含新的环境变量

### 10. 安全考虑

- 确保在生产环境中使用 HTTPS
- 定期轮换 Client Secret（如果使用）
- 监控认证日志以检测异常活动
- 考虑使用更短的 token 过期时间
