# Code signing — Windows and macOS

The signing pipeline is already **wired up**. Builds ship unsigned until you add the credentials
as **secrets in the public repo `SynapseIA25/devflow-releases`** (Settings → Secrets and variables →
Actions). Once they're there, the next release signs itself. No code changes needed.

> The **auto-updater** signing (`TAURI_SIGNING_PRIVATE_KEY` secret) is already configured and is a
> separate thing: that one prevents the "update could not be verified" error; this one prevents the
> SmartScreen (Windows) and Gatekeeper (macOS) warnings when installing.

---

## macOS — Apple Developer ID + notarization

**Requirement:** an **Apple Developer Program** membership — **US$99/year** (mandatory).

1. Enroll at https://developer.apple.com/programs/ (Apple identity verification).
2. Under **Certificates, Identifiers & Profiles**, create a **"Developer ID Application"** certificate.
3. Download it, open it in **Keychain Access**, and **export** the key as a `.p12` with a password.
4. Convert the `.p12` to base64:  `base64 -i certificate.p12 | pbcopy`
5. To notarize, generate an **app-specific password** at https://appleid.apple.com
   (Sign-In and Security → App-Specific Passwords).

**Secrets to add** to `devflow-releases`:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | the `.p12` as base64 (step 4) |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password (step 3) |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID (email) |
| `APPLE_PASSWORD` | the app-specific password (step 5) |
| `APPLE_TEAM_ID` | your Team ID (10 chars, in your developer account) |

---

## Windows — Azure Trusted Signing

**Requirement:** an **Azure** account + **Trusted Signing** (~US$10/month). It's Microsoft's modern
method (no hardware token). It requires identity verification (individual or organization).

1. In the Azure portal create a **Trusted Signing Account** resource (pick a region).
2. Inside it create a **Certificate Profile** (Public Trust). Complete the identity verification.
3. Create an **App Registration** (service principal) and give it the
   **"Trusted Signing Certificate Profile Signer"** role over the account. Save the client id,
   tenant id and a client secret.

**Secrets to add** to `devflow-releases`:

| Secret | Value |
|---|---|
| `TRUSTED_SIGNING_ENDPOINT` | `https://<region>.codesigning.azure.net/` |
| `TRUSTED_SIGNING_ACCOUNT` | the Trusted Signing Account name |
| `TRUSTED_SIGNING_PROFILE` | the Certificate Profile name |
| `AZURE_CLIENT_ID` | the service principal client id |
| `AZURE_CLIENT_SECRET` | the service principal client secret |
| `AZURE_TENANT_ID` | tenant id |

The CI installs `trusted-signing-cli` **only if `TRUSTED_SIGNING_ENDPOINT` is set**, and
`src-tauri/sign-windows.ps1` signs each artifact. Without those secrets, that script is a no-op.

---

## Testing

With the secrets in place, publish a new version (see the release flow in the public repo's README).
The build will sign and notarize automatically. Verify:

- **Windows:** right-click the `.exe` → Properties → *Digital Signatures* tab should list your
  certificate. The SmartScreen warning should no longer appear (it may take time to gain reputation).
- **macOS:** `spctl -a -vvv -t install DevFlow.app` should say `accepted` / `source=Notarized`.
