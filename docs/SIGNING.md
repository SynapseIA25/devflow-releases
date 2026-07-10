# Firma de código — Windows y macOS

El pipeline de firma ya está **cableado**. Los builds salen sin firmar hasta que cargues las
credenciales como **secrets del repo público `pab-1984/devflow-releases`** (Settings → Secrets
and variables → Actions). Apenas estén, la próxima release se firma sola. No hace falta tocar
código.

> La firma del **auto-updater** (secret `TAURI_SIGNING_PRIVATE_KEY`) ya está configurada y es
> distinta de esto: aquella evita el "no se pudo verificar el update", esta evita los avisos de
> SmartScreen (Windows) y Gatekeeper (macOS) al instalar.

---

## macOS — Apple Developer ID + notarización

**Requisito:** membresía **Apple Developer Program — US$99/año** (obligatoria).

1. Inscribite en https://developer.apple.com/programs/ (verificación de identidad de Apple).
2. En **Certificates, Identifiers & Profiles** creá un certificado **"Developer ID Application"**.
3. Descargalo, abrilo en **Acceso a Llaveros** (Keychain), y **exportá** la clave como `.p12`
   con una contraseña.
4. Convertí el `.p12` a base64:  `base64 -i certificado.p12 | pbcopy`
5. Para notarizar, generá una **contraseña específica de app** en https://appleid.apple.com
   (Seguridad → Contraseñas específicas de app).

**Secrets a cargar** en `devflow-releases`:

| Secret | Valor |
|---|---|
| `APPLE_CERTIFICATE` | el `.p12` en base64 (paso 4) |
| `APPLE_CERTIFICATE_PASSWORD` | la contraseña del `.p12` (paso 3) |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Tu Nombre (TEAMID)` |
| `APPLE_ID` | tu Apple ID (email) |
| `APPLE_PASSWORD` | la contraseña específica de app (paso 5) |
| `APPLE_TEAM_ID` | tu Team ID (10 caracteres, en la cuenta de developer) |

---

## Windows — Azure Trusted Signing

**Requisito:** cuenta de **Azure** + **Trusted Signing** (~US$10/mes). Es el método moderno de
Microsoft (sin token físico). Necesita verificación de identidad (individuo u organización).

1. En el portal de Azure creá un recurso **Trusted Signing Account** (elegí una región).
2. Dentro creá un **Certificate Profile** (Public Trust). Completá la verificación de identidad.
3. Creá un **App Registration** (service principal) y asignale el rol
   **"Trusted Signing Certificate Profile Signer"** sobre la cuenta. Guardá client id, tenant id
   y un client secret.

**Secrets a cargar** en `devflow-releases`:

| Secret | Valor |
|---|---|
| `TRUSTED_SIGNING_ENDPOINT` | `https://<region>.codesigning.azure.net/` |
| `TRUSTED_SIGNING_ACCOUNT` | nombre de la Trusted Signing Account |
| `TRUSTED_SIGNING_PROFILE` | nombre del Certificate Profile |
| `AZURE_CLIENT_ID` | client id del service principal |
| `AZURE_CLIENT_SECRET` | client secret del service principal |
| `AZURE_TENANT_ID` | tenant id |

La CI instala `trusted-signing-cli` **solo si `TRUSTED_SIGNING_ENDPOINT` está seteado**, y
`src-tauri/sign-windows.ps1` firma cada artefacto. Sin esos secrets, ese script no-opea.

---

## Probar

Cargados los secrets, publicá una versión nueva (ver el flujo de release en el README del repo
público). El build va a firmar y notarizar automáticamente. Verificá:

- **Windows:** clic derecho en el `.exe` → Propiedades → pestaña *Firmas digitales* debe listar tu
  certificado. Ya no debería saltar el aviso de SmartScreen (puede tardar en ganar reputación).
- **macOS:** `spctl -a -vvv -t install DevFlow.app` debe decir `accepted` / `source=Notarized`.
