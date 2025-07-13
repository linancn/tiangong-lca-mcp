#!/usr/bin/env node

import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import express from 'express';
import { authenticateCognitoToken } from './_shared/cognito_auth.js';
import { COGNITO_BASE_URL, COGNITO_CLIENT_ID, COGNITO_ISSUER } from './_shared/config.js';

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
    };
  },
  getClient: async (client_id) => {
    return {
      client_id,
      redirect_uris: ['https://mcp.tiangong.world/oauth/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'none',
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

// Add OAuth callback endpoint to handle authorization code from Cognito
authApp.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('OAuth error:', error, error_description);
    return res.status(400).send(`OAuth Error: ${error} - ${error_description}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch(`${COGNITO_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: COGNITO_CLIENT_ID,
        code: code as string,
        redirect_uri: 'https://mcp.tiangong.world/oauth/callback',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokens = await tokenResponse.json();

    // You can customize this response based on your needs:
    // - Store tokens in a session/database
    // - Redirect to a success page
    // - Return tokens to the client
    res.json({
      success: true,
      message: 'Authentication successful',
      // Optionally include tokens (be careful about security)
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
    });
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).send('Internal server error during token exchange');
  }
});

authApp.use(
  mcpAuthRouter({
    provider: proxyProvider,
    issuerUrl: new URL(COGNITO_ISSUER),
    baseUrl: new URL('https://mcp.tiangong.world'),
    serviceDocumentationUrl: new URL('https://docs.aws.amazon.com/cognito/'),
  }),
);

export default authApp;
