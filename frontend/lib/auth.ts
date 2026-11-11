export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      localStorage.getItem("access_token") ||
      sessionStorage.getItem("access_token")
    );
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("token_type");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("token_type");
    document.cookie = "access_token=; path=/; max-age=0";
  } catch {
    /* ignore */
  }
}