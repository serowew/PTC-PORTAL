const API_BASE_URL = "http://localhost:3000";

export type UserRole = "admin" | "student" | "faculty";

export type User = {
  username: string;
  role: UserRole;
};

export const authService = {
  async login(
    email: string,
    password: string,
  ): Promise<{ message: string } | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  async verifyOtp(email: string, otp: string): Promise<User | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { username: data.email, role: data.role };
    } catch {
      return null;
    }
  },

  savePendingEmail(email: string): void {
    sessionStorage.setItem("pending_email", email);
  },

  getPendingEmail(): string | null {
    return sessionStorage.getItem("pending_email");
  },

  clearPendingEmail(): void {
    sessionStorage.removeItem("pending_email");
  },

  saveSession(user: User): void {
    sessionStorage.setItem("user", JSON.stringify(user));
  },

  getSession(): User | null {
    const data = sessionStorage.getItem("user");
    return data ? JSON.parse(data) : null;
  },

  logout(): void {
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("pending_email");
  },
};
