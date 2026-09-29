import { createAuthClient } from 'better-auth/react';

// No Render URL: the browser's origin owns both the UI and auth cookies.
export const authClient = createAuthClient({ basePath: '/api/auth' });
