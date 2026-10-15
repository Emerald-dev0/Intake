# Intake — Google OAuth Verification Reviewer Access

## Application URL

**https://intake.calder.click**

## Reviewer Credentials

| Field | Value |
|-------|-------|
| Email | `<provided separately via secure channel>` |
| Password | `<provided separately via secure channel>` |

Credentials are delivered through a secure channel outside this repository.

## Signing In to Intake

1. Open **https://intake.calder.click**
2. Click **Sign in** (top-right of the page)
3. Enter the reviewer email and password above
4. You will be redirected to the Intake dashboard

Signing in to Intake authenticates you as a user of the application. It does **not** grant Intake access to any Google account.

## Connecting a Google Account (Separate Authorization)

After signing in to Intake, connect a Google account separately to test the Google Forms integration. Intake requires this authorization to create and manage forms in the Google account you choose.

**This is a separate step from signing in.** The two authorizations are independent:

| Step | What it does |
|------|-------------|
| **Sign in to Intake** | Authenticates you as an Intake user. Does not access Google. |
| **Connect Google account** | Authorizes Intake to create/edit Google Forms in your Google account. |

### How to connect a Google account:

1. After signing in to Intake, navigate to **Connections** in the left sidebar
2. Under **Google Forms**, click **Connect Google**
3. Google's consent screen will appear — review the permissions:
   - **Confirm the Google account you connect** (`openid`)
   - **See the email address of that Google account** (`email`)
   - **Create and edit your Google Forms** (`forms.body`)
4. Click **Allow**
5. You will be returned to Intake. The connection status should show **Connected**

## Testing the Google Forms Integration

### 1. Create a form through Intake

1. From the dashboard, navigate to **Forms**
2. Click **Create form**
3. Describe the form you want in plain English (e.g., "A feedback form for a workshop with name, email, and rating questions")
4. Review the proposed questions — edit, add, or remove as needed
5. Click **Create form**
6. Intake creates the Google Form in your connected Google account

### 2. Verify the form in Google Forms

1. Open **https://forms.google.com** in a new tab
2. Check that the form you just created appears in your Google Forms dashboard
3. Open the form and verify the questions match what you approved in Intake

### 3. Edit the form through Intake

1. Return to Intake → **Forms**
2. Click on the form you created
3. Describe the change (e.g., "Add a question asking for the attendee's role")
4. Review the proposed changes
5. Confirm the edit
6. Return to Google Forms and verify the changes appear

### 4. Publish and share

1. In Intake, open the form
2. Click **Publish**
3. Copy the share link
4. Open the link in an incognito window to verify it is accessible

### 5. Response viewing (optional)

If response summaries are enabled:
1. Navigate to the form in Intake
2. Look for a **Response insights** or similar section
3. Intake can show aggregated response summaries without reading individual responses

## Expected Results at Each Step

| Step | Expected result |
|------|----------------|
| Sign in to Intake | Dashboard loads, showing your workspace |
| Connect Google | Consent screen appears, then status shows "Connected" |
| Create form | A new Google Form appears in your Google account with the approved questions |
| Edit form | Changes appear in Google Forms after confirmation |
| Publish form | Form is published and accessible via share link |

## Important Notes

- **Intake authentication and Google authorization are separate.** Signing in to Intake does not automatically connect any Google account.
- **You must use a Google account you control** for the verification. Do not use the developer's account.
- **The reviewer account has no access to other users' data.** Each user's forms, responses, and connections are private to their account.
- **The `forms.body` scope** is required for Intake to create and edit Google Forms on your behalf. Without it, the integration cannot function.
- **The `forms.responses.readonly` scope** is optional and only used if you enable response summaries. It is not required for form creation or editing.

## Support

If you encounter any issues during verification:
- Check that you signed in with the correct reviewer credentials
- Ensure you completed both the Intake sign-in and the Google authorization steps
- Try clearing your browser cache and signing in again
