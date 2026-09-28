# Provider boundary (next PR)

There is deliberately no provider implementation in this stage. An Intake login (`auth.ts`, Better Auth tables) answers **who the user is**. A provider connection will answer **which separate Google/Microsoft account the user explicitly authorized**, with scopes limited to the intended provider operations.

When implemented, keep provider grants and operations in this boundary, associate connections with the authenticated Intake user ID, and check that ownership on every server operation. Never reuse the Better Auth credential `account` row as proof of permission to operate Google or Microsoft Forms. No tokens, connection tables, mock forms or OAuth scopes are created in PR 02.
