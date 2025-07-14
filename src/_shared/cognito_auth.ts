import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID } from './config.js';

export interface AuthResult {
  isAuthenticated: boolean;
  response?: string;
  userId?: string;
  email?: string;
}

// Create Cognito JWT verifier for access tokens
const verifier = CognitoJwtVerifier.create({
  userPoolId: COGNITO_USER_POOL_ID,
  tokenUse: 'access',
  clientId: COGNITO_CLIENT_ID,
});

/**
 * Authenticate Cognito JWT access token
 * @param token - JWT access token
 * @returns AuthResult containing authentication status and user information
 */
export async function authenticateCognitoToken(token: string): Promise<AuthResult> {
  try {
    // Verify JWT token directly with AWS Cognito
    const payload = await verifier.verify(token);

    // Extract user information from token payload
    const userId = (payload.sub as string) || (payload['cognito:username'] as string);
    const email = (payload.email as string) || (payload['cognito:email'] as string);

    if (!userId) {
      return {
        isAuthenticated: false,
        response: 'Invalid token: missing user ID',
      };
    }

    return {
      isAuthenticated: true,
      response: userId,
      userId,
      email,
    };
  } catch (error) {
    console.error('Cognito token verification failed:', error);
    return {
      isAuthenticated: false,
      response: error instanceof Error ? error.message : 'Token verification failed',
    };
  }
}

// /**
//  * Authenticate Cognito ID token (contains more user information than access token)
//  * @param idToken - Cognito ID token
//  * @returns AuthResult containing authentication status and user information
//  */
// export async function authenticateCognitoIdToken(idToken: string): Promise<AuthResult> {
//   try {
//     // Create separate verifier for ID token
//     const idVerifier = CognitoJwtVerifier.create({
//       userPoolId: COGNITO_USER_POOL_ID,
//       tokenUse: 'id',
//       clientId: COGNITO_CLIENT_ID,
//     });

//     // Verify ID token with AWS Cognito
//     const payload = await idVerifier.verify(idToken);

//     // Extract user information from ID token payload
//     const userId = payload.sub as string;
//     const email = payload.email as string;
//     const name = payload.name as string;

//     return {
//       isAuthenticated: true,
//       response: userId,
//       userId,
//       email,
//     };
//   } catch (error) {
//     console.error('Cognito ID token verification failed:', error);
//     return {
//       isAuthenticated: false,
//       response: error instanceof Error ? error.message : 'ID token verification failed',
//     };
//   }
// }
