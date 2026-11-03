import { secretsStore } from "../../secrets/local_file/secrets_store.js";

export const DEFAULT_GITHUB_TOKEN_REF = "secret_github_default";

export function getGitHubToken(credentialRef?: string | null): string | null {
  return (
    (credentialRef ? secretsStore.getSecret(credentialRef) : null) ||
    secretsStore.getSecret(DEFAULT_GITHUB_TOKEN_REF)
  );
}

/** Process-local HTTPS authentication; never persisted in Git config or passed in argv. */
export function gitHubAuthentication(
  url: string,
): Record<string, string | undefined> {
  const token = getGitHubToken();
  if (!token) return {};
  return {
    // A longer identity rewrite overrides host-level HTTPS-to-SSH rewrites for this URL.
    GIT_CONFIG_COUNT: "5",
    GIT_CONFIG_KEY_0: `url.${url}.insteadOf`,
    GIT_CONFIG_VALUE_0: url,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_CONFIG_KEY_2: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_2: "",
    GIT_CONFIG_KEY_3: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_3: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_CONFIG_KEY_4: "http.followRedirects",
    GIT_CONFIG_VALUE_4: "false",
    GIT_TRACE: undefined,
    GIT_TRACE_CURL: undefined,
    GIT_CURL_VERBOSE: undefined,
  };
}
