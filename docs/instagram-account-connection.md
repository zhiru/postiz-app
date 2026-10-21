# Connecting an Instagram account

Search accounts returned by Meta by display name or Instagram username, with or without `@` and without requiring accents. Select an account, then save. Search does not request new permissions or discover accounts outside that authorization.

Save and Cancel remain outside the account list. Back to calendar exits without removing an existing channel. Public links use their configured return destination when available. Leaving prevents late responses from redirecting the browser again; it does not undo a save already submitted.

Cancelled or expired authorization, network failures and requests stalled for one minute show an error with a way back. The same OAuth code is never retried automatically. If saving cannot be confirmed, check the calendar before connecting again. Reloading step two requires restarting authorization because the account list is held in memory.

## Missing accounts

For Facebook Login, Meta must expose a Facebook Page linked to the professional Instagram account. Confirm the Page connection, the person's Page access and the accounts selected during authorization. Start a new connection from the calendar; preserve working channels.

[Meta documentation](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram)

This update does not alter schema, synchronization, automations, webhooks or credential settings.
