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
// Backend Auth User
//
// Supports:
// role_name = current backend format
// role      = optional future format
// ======================

interface BackendUser {
  user_id: number;
  username: string;
  email: string;
  role_id: number;

  role_name?: UserRole;
  role?: UserRole;
}

// ======================
// Authentication Response
// ======================

interface AuthResponse {
  success: boolean;
  message: string;
  token: string;
  user: BackendUser;
}

// ======================
// Current User Response
// ======================

interface CurrentUserResponse {
  success: boolean;
  user: BackendUser;
}

// ======================
// VALID ROLES
// ======================

const VALID_ROLES: UserRole[] = [
  "Admin",
  "Registrar",
  "Program Head",
  "Faculty",
  "Student",
];

// ======================
// Convert backend user
//
// Backend:
// role_name: "Student"
//
// Frontend:
// role: "Student"
// ======================

function mapBackendUser(user: BackendUser): User {
  const role = user.role ?? user.role_name;

  if (!role || !VALID_ROLES.includes(role)) {
    throw new Error(
      `Invalid or missing user role returned by server: ${String(role)}`,
    );
  }

  const userId = Number(user.user_id);
  const roleId = Number(user.role_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid user ID returned by the authentication server.");
  }

  if (!Number.isInteger(roleId) || roleId <= 0) {
    throw new Error("Invalid role ID returned by the authentication server.");
  }

  return {
    user_id: userId,
    username: user.username,
    email: user.email,
    role_id: roleId,
    role,
  };
}

// ======================
// Authentication Service
// ======================

export const authService = {
  // =====================================================
  // STEP 1 — NORMAL LOGIN
  //
  // Username + Password
  //
  // IMPORTANT:
  // Starting a new login removes any previous authenticated
  // account from this browser tab/session.
  //
  // This prevents:
  //
  // Student A session
  //       ↓
  // Student B login
  //       ↓
  // old Student A JWT interfering with Student B OTP
  // =====================================================

  async login(username: string, password: string): Promise<LoginResponse> {
    // =====================================================
    // START CLEAN AUTHENTICATION FLOW
    // =====================================================

    sessionStorage.removeItem("user");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("pending_username");

    // =====================================================
    // NORMALIZE USERNAME
    // =====================================================

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      throw new Error("Username is required.");
    }

    if (!password) {
      throw new Error("Password is required.");
    }

    // =====================================================
    // LOGIN REQUEST
    // =====================================================

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        username: cleanUsername,
        password,
      }),
    });

    // =====================================================
    // READ RESPONSE
    // =====================================================

    const data: LoginResponse & {
      error?: string;
      success?: boolean;
    } = await response.json();

    // =====================================================
    // ERROR
    // =====================================================

    if (!response.ok) {
      throw new Error(data.error || data.message || "Login failed.");
    }

    // =====================================================
    // OTP FLOW STARTED
    //
    // Save ONLY the username currently waiting for OTP.
    // =====================================================

    this.savePendingUsername(cleanUsername);

    return data;
  },

  // =====================================================
  // STEP 2 — VERIFY OTP
  //
  // Successful OTP:
  //
  // Backend returns:
  //
  // token
  // +
  // user
  //
  // Then frontend:
  //
  // maps role_name → role
  // clears old credentials
  // stores NEW JWT
  // stores NEW user session
  // clears pending username
  // =====================================================

  async verifyOtp(username: string, otp: string): Promise<User> {
    const cleanUsername = username.trim();
    const cleanOtp = otp.trim();

    if (!cleanUsername) {
      throw new Error("Username is required.");
    }

    if (!cleanOtp) {
      throw new Error("OTP is required.");
    }

    // =====================================================
    // VERIFY OTP REQUEST
    // =====================================================

    const response = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        username: cleanUsername,
        otp: cleanOtp,
      }),
    });

    // =====================================================
    // READ RESPONSE
    // =====================================================

    const data: AuthResponse & {
      error?: string;
    } = await response.json();

    // =====================================================
    // ERROR
    // =====================================================

    if (!response.ok) {
      throw new Error(data.error || data.message || "OTP verification failed.");
    }

    // =====================================================
    // TOKEN VALIDATION
    // =====================================================

    if (!data.token) {
      throw new Error("Authentication token was not returned by the server.");
    }

    // =====================================================
    // USER VALIDATION
    // =====================================================

    if (!data.user) {
      throw new Error("Authenticated user information was not returned.");
    }

    // =====================================================
    // MAP BACKEND USER
    //
    // This validates role before saving anything.
    // =====================================================

    const user = mapBackendUser(data.user);

    // =====================================================
    // REPLACE AUTHENTICATED SESSION
    //
    // Make absolutely sure credentials from another
    // account cannot remain.
    // =====================================================

    this.clearToken();

    sessionStorage.removeItem("user");

    // =====================================================
    // SAVE NEW AUTHENTICATED ACCOUNT
    // =====================================================

    this.saveToken(data.token);

    this.saveSession(user);

    // =====================================================
    // OTP FLOW COMPLETE
    // =====================================================

    this.clearPendingUsername();

    return user;
  },

  // =====================================================
  // DEVELOPMENT LOGIN
  //
  // One-click login but still:
  //
  // - loads REAL user from database
  // - receives REAL JWT
  // - uses REAL RBAC
  //
  // Backend /auth/dev-login must be disabled in production.
  // =====================================================

  async devLogin(username: string): Promise<User> {
    // =====================================================
    // CLEAR PREVIOUS ACCOUNT FIRST
    // =====================================================

    sessionStorage.removeItem("user");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("pending_username");

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      throw new Error("Username is required.");
    }

    // =====================================================
    // REQUEST
    // =====================================================

    const response = await fetch(`${API_BASE_URL}/auth/dev-login`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        username: cleanUsername,
      }),
    });

    // =====================================================
    // RESPONSE
    // =====================================================

    const data: AuthResponse & {
      error?: string;
    } = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Development login failed.",
      );
    }

    if (!data.token) {
      throw new Error("Authentication token was not returned by the server.");
    }

    if (!data.user) {
      throw new Error("Development user information was not returned.");
    }

    // =====================================================
    // MAP BACKEND USER
    // =====================================================

    const user = mapBackendUser(data.user);

    // =====================================================
    // SAVE REAL JWT + SESSION
    // =====================================================

    this.saveToken(data.token);

    this.saveSession(user);

    return user;
  },

  // =====================================================
  // AUTHENTICATED FETCH
  //
  // Use this instead of normal fetch() for protected APIs.
  //
  // Automatically sends:
  //
  // Authorization:
  // Bearer <JWT>
  // =====================================================

  async authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = this.getToken();

    // =====================================================
    // TOKEN REQUIRED
    // =====================================================

    if (!token) {
      this.logout();

      throw new Error("Authentication required. Please login again.");
    }

    // =====================================================
    // HEADERS
    // =====================================================

    const headers = new Headers(options.headers || {});

    headers.set("Authorization", `Bearer ${token}`);

    // Add JSON Content-Type only when:
    //
    // - request has body
    // - caller did not already set Content-Type
    // - body is not FormData
    //
    // Browser must create multipart/form-data boundary
    // automatically for FormData.
    if (
      options.body &&
      !headers.has("Content-Type") &&
      !(options.body instanceof FormData)
    ) {
      headers.set("Content-Type", "application/json");
    }

    // =====================================================
    // REQUEST
    // =====================================================

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // =====================================================
    // JWT INVALID / EXPIRED
    // =====================================================

    if (response.status === 401) {
      this.logout();
    }

    return response;
  },

  // =====================================================
  // GET CURRENT AUTHENTICATED USER
  //
  // Backend is the source of truth.
  //
  // GET /auth/me
  // =====================================================

  async getCurrentUser(): Promise<User> {
    const response = await this.authFetch(`${API_BASE_URL}/auth/me`, {
      method: "GET",

      headers: {
        Accept: "application/json",
      },
    });

    // =====================================================
    // RESPONSE
    // =====================================================

    const data: CurrentUserResponse & {
      error?: string;
      message?: string;
    } = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Unable to verify authenticated user.",
      );
    }

    if (!data.user) {
      throw new Error("Authenticated user information was not returned.");
    }

    // =====================================================
    // MAP BACKEND USER
    // =====================================================

    const user = mapBackendUser(data.user);

    // =====================================================
    // REFRESH FRONTEND SESSION FROM BACKEND TRUTH
    // =====================================================

    this.saveSession(user);

    return user;
  },

  // =====================================================
  // TOKEN STORAGE
  // =====================================================

  saveToken(token: string): void {
    sessionStorage.setItem("access_token", token);
  },

  getToken(): string | null {
    return sessionStorage.getItem("access_token");
  },

  clearToken(): void {
    sessionStorage.removeItem("access_token");
  },

  // =====================================================
  // PENDING USERNAME
  //
  // Used only between:
  //
  // Login
  //   ↓
  // OTP
  // =====================================================

  savePendingUsername(username: string): void {
    sessionStorage.setItem("pending_username", username.trim());
  },

  getPendingUsername(): string | null {
    return sessionStorage.getItem("pending_username");
  },

  clearPendingUsername(): void {
    sessionStorage.removeItem("pending_username");
  },

  // =====================================================
  // FRONTEND USER SESSION
  //
  // Used for:
  //
  // - UI display
  // - role-based navigation
  // - ProtectedRoute
  //
  // NOT the security authority.
  //
  // Backend JWT + RBAC remains authoritative.
  // =====================================================

  saveSession(user: User): void {
    sessionStorage.setItem("user", JSON.stringify(user));
  },

  getSession(): User | null {
    const session = sessionStorage.getItem("user");

    if (!session) {
      return null;
    }

    try {
      const parsed = JSON.parse(session) as User;

      // ===================================================
      // BASIC SESSION VALIDATION
      // ===================================================

      if (
        !parsed ||
        !Number(parsed.user_id) ||
        !parsed.username ||
        !parsed.role ||
        !VALID_ROLES.includes(parsed.role)
      ) {
        console.error("INVALID USER SESSION STRUCTURE:", parsed);

        this.logout();

        return null;
      }

      return parsed;
    } catch (error) {
      console.error("INVALID USER SESSION:", error);

      this.logout();

      return null;
    }
  },

  // =====================================================
  // LOGOUT
  // =====================================================

  logout(): void {
    sessionStorage.removeItem("user");

    sessionStorage.removeItem("access_token");

    sessionStorage.removeItem("pending_username");
  },

  // =====================================================
  // AUTH HELPERS
  // =====================================================

  isLoggedIn(): boolean {
    return Boolean(this.getSession() && this.getToken());
  },

  hasRole(role: UserRole): boolean {
    const user = this.getSession();

    return user?.role === role;
  },

  // =====================================================
  // ROLE DASHBOARD
  // =====================================================

  getDashboardRoute(role: UserRole): string {
    const routes: Record<UserRole, string> = {
      Admin: "/admin/dashboard",

      Registrar: "/registrar/dashboard",

      "Program Head": "/programhead/dashboard",

      Faculty: "/faculty/dashboard",

      Student: "/student/dashboard",
    };

    return routes[role];
  },
};

export { API_BASE_URL };
