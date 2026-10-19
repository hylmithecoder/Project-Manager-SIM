export interface GoogleIdentityServices {
  accounts: { id: {
    initialize(options: {
      client_id: string;
      callback: (response: { credential?: string }) => void;
      auto_select: boolean;
      use_fedcm_for_button: boolean;
    }): void;
    renderButton(element: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number; locale: string }): void;
  } };
}

export function mountGoogleSignIn(element: HTMLElement, clientId: string, onCredential: (credential: string) => void): () => void {
  const google = (window as typeof window & { google?: GoogleIdentityServices }).google;
  if (!google) throw new Error("Google belum dimuat. Muat ulang atau gunakan email dan password.");
  let active = true;
  google.accounts.id.initialize({
    client_id: clientId, auto_select: false, use_fedcm_for_button: true,
    callback: ({ credential }) => { if (active && credential) onCredential(credential); },
  });
  google.accounts.id.renderButton(element, {
    type: "standard", theme: "outline", size: "large", text: "signin_with", width: 300, locale: "id",
  });
  return () => { active = false; element.replaceChildren(); };
}
