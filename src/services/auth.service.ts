const API_BASE_URL = "http://localhost:3000";

// ======================
// User Roles
// ======================
export type UserRole =
  | "Admin"
  | "Registrar"
  | "Program Head"
  | "Faculty"
  | "Student";

// ======================
// User Session
// ======================
export interface User {
  user_id: number;
  student_id?: number;
  username: string;
  email: string;
  role: UserRole;
  role_id: number;
}

// ======================
// Login Response
// ======================
export interface LoginResponse {
  message: string;
}

// ======================
// Authentication Service
// ======================
export const authService = {
  // ----------------------
  // Step 1 - Login
  // ----------------------
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error);
    }

    return data;
  },

  // ----------------------
  // Step 2 - Verify OTP
  // ----------------------
  async verifyOtp(username: string, otp: string): Promise<User | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          otp,
        }),
      });

      if (!res.ok) return null;

      const data = await res.json();

      return {
        user_id: data.user_id,
        student_id: data.student_id,
        username: data.username,
        email: data.email,
        role: data.role,
        role_id: data.role_id,
      };
    } catch (err) {
      console.error(err);
      return null;
    }
  },

  // ----------------------
  // Pending Email
  // ----------------------
  savePendingUsername(username: string): void {
    sessionStorage.setItem("pending_username", username);
  },

  getPendingUsername(): string | null {
    return sessionStorage.getItem("pending_username");
  },

  clearPendingUsername(): void {
    sessionStorage.removeItem("pending_username");
  },

  // ----------------------
  // User Session
  // ----------------------
  saveSession(user: User): void {
    sessionStorage.setItem("user", JSON.stringify(user));
  },

  getSession(): User | null {
    const session = sessionStorage.getItem("user");

    if (!session) return null;

    return JSON.parse(session) as User;
  },

  // ----------------------
  // Logout
  // ----------------------
  logout(): void {
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("pending_email");
  },

  // ----------------------
  // Helpers
  // ----------------------
  isLoggedIn(): boolean {
    return this.getSession() !== null;
  },

  hasRole(role: UserRole): boolean {
    const user = this.getSession();

    return user?.role === role;
  },
};
