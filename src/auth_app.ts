#!/usr/bin/env node

import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import express from 'express';
import { authenticateCognitoToken } from './_shared/cognito_auth.js';
import { COGNITO_BASE_URL, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET } from './_shared/config.js';

const proxyProvider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl: `${COGNITO_BASE_URL}/oauth2/authorize`,
    tokenUrl: `${COGNITO_BASE_URL}/oauth2/token`,
    revocationUrl: `${COGNITO_BASE_URL}/oauth2/revoke`,
  },
  verifyAccessToken: async (token) => {
    const authResult = await authenticateCognitoToken(token);
    if (!authResult.isAuthenticated) {
      throw new Error('Invalid token');
    }
    return {
      token,
      clientId: COGNITO_CLIENT_ID,
      scopes: ['openid', 'email', 'profile'],
      // Accept the user pool as the valid audience for this MCP server
      audience: COGNITO_CLIENT_ID,
    };
  },
  getClient: async (client_id) => {
    return {
      client_id,
      redirect_uris: ['https://mcp.tiangong.world/oauth/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_post',
      code_challenge_methods_supported: ['S256'],
      scope: 'openid email profile',
      // // Cognito specific configuration
      // id_token_signed_response_alg: 'RS256',
      // userinfo_signed_response_alg: 'RS256',
      // // OAuth 2.0 standard configuration
      // require_auth_time: false,
      // default_max_age: 86400,
      // token_endpoint_auth_signing_alg: 'RS256',
    };
  },
});

const authApp = express();
// Trust proxy for load balancers/reverse proxies - restrict to first hop only
authApp.set('trust proxy', 1);
authApp.use(express.json());
authApp.use(express.urlencoded({ extended: true })); // Add support for URL-encoded form data

// Add CORS headers for OAuth endpoints
authApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Add OAuth callback endpoint to handle authorization code from Cognito
authApp.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log('OAuth callback received:', { code: !!code, state, error, error_description });

  if (error) {
    console.error('OAuth error:', error, error_description);
    return res.status(400).send(`OAuth Error: ${error} - ${error_description}`);
  }

  if (!code) {
    console.error('Missing authorization code in callback');
    return res.status(400).send('Missing authorization code');
  }

  // Since we're using PKCE, the token exchange should be done client-side
  // where the code_verifier is available. Just return the authorization code.
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Authentication Successful - Tiangong LCA MCP</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          margin: 40px; 
          background-color: #f5f5f5; 
        }
        .container { 
          max-width: 800px; 
          margin: 0 auto; 
          background: white; 
          padding: 30px; 
          border-radius: 8px; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
          color: #333;
        }
        .section { 
          margin: 30px 0; 
          padding: 20px; 
          border: 1px solid #ddd; 
          border-radius: 6px;
          background-color: #fafafa;
        }
        .success { 
          color: #2e7d32; 
          background-color: #e8f5e8;
          padding: 15px;
          border-radius: 4px;
          border-left: 4px solid #2e7d32;
          margin: 15px 0;
        }
        .code-display { 
          background: #f5f5f5; 
          padding: 15px; 
          border-radius: 4px; 
          border-left: 4px solid #1976d2; 
          margin: 15px 0; 
          font-family: monospace; 
          word-break: break-all; 
        }
        .link {
          color: #1976d2;
          text-decoration: none;
          font-weight: bold;
          background: #1976d2;
          color: white;
          padding: 12px 24px;
          border-radius: 4px;
          display: inline-block;
          margin: 10px 10px 0 0;
          transition: background-color 0.3s;
        }
        .link:hover {
          background: #1565c0;
          text-decoration: none;
        }
        button {
          background: #1976d2;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          margin: 10px 10px 0 0;
          transition: background-color 0.3s;
        }
        button:hover {
          background: #1565c0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Authentication Successful!</h1>
          <p>Your OAuth authorization has been completed successfully</p>
        </div>
        
        <div class="success">
          <p><strong>✅ Authorization Code Received</strong></p>
          <p>You can now exchange this code for an access token using PKCE.</p>
        </div>
        
        <div class="section">
          <h3>🔑 Your Authorization Code</h3>
          <div class="code-display">${code}</div>
          <p>Use this code along with your stored code verifier to exchange for an access token in the demo interface.</p>
        </div>
        
        <div class="section">
          <h3>🚀 Next Steps</h3>
          <ol>
            <li>Copy the authorization code above</li>
            <li>Return to the OAuth demo page</li>
            <li>Paste the code in the "Exchange Authorization Code" section</li>
            <li>Click "Exchange for Token" to get your access token</li>
          </ol>
        </div>
        
        <div class="section">
          <button onclick="window.close()">Close Window</button>
          <a href="/oauth/demo" class="link">Back to OAuth Demo</a>
          <a href="/oauth/index" class="link">Return to Main Page</a>
        </div>
      </div>
      
      <script>
        // Try to communicate with parent window if in popup
        if (window.opener) {
          window.opener.postMessage({ 
            type: 'oauth_success', 
            code: '${code}',
            state: '${state || ''}'
          }, '*');
        }
      </script>
    </body>
    </html>
  `);
});

// Add token exchange endpoint that handles PKCE
authApp.post('/token', async (req, res) => {
  console.log(`Token endpoint hit: ${req.method} ${req.path} -> ${req.originalUrl}`);
  console.log('Request body:', req.body);

  const { grant_type, client_id, code, redirect_uri, code_verifier } = req.body;

  console.log('Token exchange request received:', {
    grant_type,
    client_id,
    code: !!code,
    redirect_uri,
    code_verifier: !!code_verifier,
  });

  // Validate required parameters
  if (!grant_type || grant_type !== 'authorization_code') {
    return res
      .status(400)
      .json({ error: 'invalid_request', error_description: 'Invalid or missing grant_type' });
  }

  if (!client_id || client_id !== COGNITO_CLIENT_ID) {
    return res
      .status(400)
      .json({ error: 'invalid_client', error_description: 'Invalid or missing client_id' });
  }

  if (!code) {
    return res
      .status(400)
      .json({ error: 'invalid_request', error_description: 'Missing authorization code' });
  }

  if (!redirect_uri || redirect_uri !== 'https://mcp.tiangong.world/oauth/callback') {
    return res
      .status(400)
      .json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
  }

  if (!code_verifier) {
    return res
      .status(400)
      .json({ error: 'invalid_request', error_description: 'Missing code_verifier for PKCE' });
  }

  try {
    // Exchange authorization code for tokens with PKCE
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: COGNITO_CLIENT_ID,
      code: code,
      redirect_uri: redirect_uri,
      code_verifier: code_verifier,
    });

    console.log('Cognito token exchange request:', {
      url: `${COGNITO_BASE_URL}/oauth2/token`,
      params: Object.fromEntries(tokenParams.entries()),
      hasClientSecret: !!COGNITO_CLIENT_SECRET,
    });

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    // Add authentication based on client type
    if (COGNITO_CLIENT_SECRET) {
      // Confidential client - use Basic Auth with client secret
      const credentials = Buffer.from(`${COGNITO_CLIENT_ID}:${COGNITO_CLIENT_SECRET}`).toString(
        'base64',
      );
      headers['Authorization'] = `Basic ${credentials}`;
    }
    // For public clients, no authentication header is needed

    const tokenResponse = await fetch(`${COGNITO_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers,
      body: tokenParams,
    });

    const responseText = await tokenResponse.text();
    console.log('Cognito token exchange response:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      body: responseText,
    });

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', responseText);
      return res.status(tokenResponse.status).json({
        error: 'invalid_grant',
        error_description: `Token exchange failed: ${responseText}`,
      });
    }

    const tokens = JSON.parse(responseText);

    // Return tokens to client
    const response = {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
      ...(tokens.id_token && { id_token: tokens.id_token }),
    };

    console.log('Sending success response to client:', {
      hasAccessToken: !!response.access_token,
      hasRefreshToken: !!response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
    });

    res.json(response);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error during token exchange',
    });
  }
});

authApp.use(
  mcpAuthRouter({
    provider: proxyProvider,
    issuerUrl: new URL('https://mcp.tiangong.world/oauth'),
    baseUrl: new URL('https://mcp.tiangong.world/oauth'),
    serviceDocumentationUrl: new URL('https://docs.aws.amazon.com/cognito/'),
  }),
);

export default authApp;
