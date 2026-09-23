import { API_BASE_URL } from "./api";

export { API_BASE_URL };
// ======================
// User Roles
// ======================

export type UserRole =
  | "Admin"
  | "Registrar"
  | "Program Head"
  | "Faculty"
  | "Finance"
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

export interface ResendOtpResponse {
  success?: boolean;
  message: string;
  cooldown_seconds?: number;
  retry_after?: number;
}

// ======================
// Forgot Password
// ======================

export interface ForgotPasswordResponse {
  success: boolean;
  message: string;
  requestId: string;
}

export interface VerifyResetOtpResponse {
  success: boolean;
  message: string;
  verified: boolean;
  resetToken: string;
}

export interface ResetPasswordResponse {
  success: boolean;
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
  "Finance",
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

const LOGIN_COOLDOWN_UNTIL_KEY = "login_cooldown_until";

function saveLoginCooldownState(lockedUntil: number): void {
  sessionStorage.setItem(
    LOGIN_COOLDOWN_UNTIL_KEY,
    String(Math.max(0, Math.floor(lockedUntil))),
  );
}

function getLoginCooldownRemainingState(): number {
  const storedUntil = sessionStorage.getItem(LOGIN_COOLDOWN_UNTIL_KEY);

  if (!storedUntil) {
    return 0;
  }

  const lockedUntil = Number(storedUntil);

  if (!Number.isFinite(lockedUntil) || lockedUntil <= 0) {
    sessionStorage.removeItem(LOGIN_COOLDOWN_UNTIL_KEY);
    return 0;
  }

  const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  if (remaining <= 0) {
    sessionStorage.removeItem(LOGIN_COOLDOWN_UNTIL_KEY);
    return 0;
  }

  return remaining;
}

function clearLoginCooldownState(): void {
  sessionStorage.removeItem(LOGIN_COOLDOWN_UNTIL_KEY);
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
    sessionStorage.removeItem("otp_resend_available_at");

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
      locked?: boolean;
      retry_after?: number;
      attempts_remaining?: number;
    } = await response.json();

    // =====================================================
    // ERROR
    // =====================================================

    if (!response.ok) {
      const message = data.error || data.message || "Login failed.";

      const retryAfter =
        Number.isFinite(Number(data.retry_after)) &&
        Number(data.retry_after) > 0
          ? Number(data.retry_after)
          : 0;

      if ((response.status === 429 || data.locked === true) && retryAfter > 0) {
        saveLoginCooldownState(Date.now() + retryAfter * 1000);
      }

      throw new Error(message);
    }

    // =====================================================
    // OTP FLOW STARTED
    //
    // Save ONLY the username currently waiting for OTP.
    // =====================================================

    clearLoginCooldownState();
    this.savePendingUsername(cleanUsername);
    this.saveOtpResendAvailableAt(Date.now() + 60_000);

    return data;
  },

  // =====================================================
  // RESEND OTP
  //
  // POST /auth/resend-otp
  //
  // The backend enforces the real 60-second cooldown.
  // =====================================================

  async resendOtp(username: string): Promise<ResendOtpResponse> {
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      throw new Error("Username is required.");
    }

    const response = await fetch(`${API_BASE_URL}/auth/resend-otp`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        username: cleanUsername,
      }),
    });

    const data: ResendOtpResponse & {
      error?: string;
    } = await response.json();

    if (!response.ok) {
      if (
        response.status === 429 &&
        Number.isFinite(Number(data.retry_after)) &&
        Number(data.retry_after) > 0
      ) {
        this.saveOtpResendAvailableAt(
          Date.now() + Number(data.retry_after) * 1000,
        );
      }

      throw new Error(data.error || data.message || "Unable to resend OTP.");
    }

    this.savePendingUsername(cleanUsername);

    const cooldownSeconds =
      Number.isFinite(Number(data.cooldown_seconds)) &&
      Number(data.cooldown_seconds) > 0
        ? Number(data.cooldown_seconds)
        : 60;

    this.saveOtpResendAvailableAt(Date.now() + cooldownSeconds * 1000);

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
    this.clearOtpResendAvailableAt();

    return user;
  },

  // =====================================================
  // FORGOT PASSWORD — REQUEST RESET OTP
  //
  // POST /auth/forgot-password
  //
  // Flow:
  //
  // Forgot Password
  //      ↓
  // Enter username
  //      ↓
  // Backend creates password reset request
  //      ↓
  // OTP sent through email
  //      ↓
  // requestId returned
  // =====================================================

  async forgotPassword(username: string): Promise<ForgotPasswordResponse> {
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      throw new Error("Username is required.");
    }

    const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        username: cleanUsername,
      }),
    });

    const data: ForgotPasswordResponse & {
      error?: string;
    } = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          data.message ||
          "Unable to process the password reset request.",
      );
    }

    if (!data.requestId) {
      throw new Error(
        "Password reset request ID was not returned by the server.",
      );
    }

    return data;
  },

  // =====================================================
  // FORGOT PASSWORD — VERIFY OTP
  //
  // POST /auth/forgot-password/verify
  //
  // Successful verification returns a temporary
  // password-reset authorization token.
  //
  // IMPORTANT:
  //
  // This is NOT the normal login JWT.
  // =====================================================

  async verifyResetOtp(
    requestId: string,
    otp: string,
  ): Promise<VerifyResetOtpResponse> {
    const cleanRequestId = requestId.trim();
    const cleanOtp = otp.trim();

    if (!cleanRequestId) {
      throw new Error("Password reset request is missing.");
    }

    if (!cleanOtp) {
      throw new Error("Verification code is required.");
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      throw new Error("Verification code must be 6 digits.");
    }

    const response = await fetch(
      `${API_BASE_URL}/auth/forgot-password/verify`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },

        body: JSON.stringify({
          requestId: cleanRequestId,
          otp: cleanOtp,
        }),
      },
    );

    const data: VerifyResetOtpResponse & {
      error?: string;
    } = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          data.message ||
          "Unable to verify the password reset code.",
      );
    }

    if (!data.verified) {
      throw new Error("Password reset verification was not completed.");
    }

    if (!data.resetToken) {
      throw new Error(
        "Password reset authorization was not returned by the server.",
      );
    }

    return data;
  },

  // =====================================================
  // FORGOT PASSWORD — RESEND OTP
  //
  // POST /auth/forgot-password/resend
  //
  // IMPORTANT:
  //
  // The backend creates a NEW requestId.
  // The frontend must replace the old requestId.
  // =====================================================

  async resendResetOtp(requestId: string): Promise<ForgotPasswordResponse> {
    const cleanRequestId = requestId.trim();

    if (!cleanRequestId) {
      throw new Error("Password reset request is missing.");
    }

    const response = await fetch(
      `${API_BASE_URL}/auth/forgot-password/resend`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },

        body: JSON.stringify({
          requestId: cleanRequestId,
        }),
      },
    );

    const data: ForgotPasswordResponse & {
      error?: string;
      retryAfterSeconds?: number;
    } = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Unable to resend the verification code.",
      );
    }

    if (!data.requestId) {
      throw new Error("New password reset request ID was not returned.");
    }

    return data;
  },

  // =====================================================
  // FORGOT PASSWORD — RESET PASSWORD
  //
  // POST /auth/forgot-password/reset
  //
  // requestId
  // resetToken
  // newPassword
  //      ↓
  // Backend validates verified reset request
  //      ↓
  // bcrypt hashes password
  //      ↓
  // users.password_hash updated
  //      ↓
  // reset request marked used
  //      ↓
  // activity log created
  // =====================================================

  async resetPassword(
    requestId: string,
    resetToken: string,
    newPassword: string,
  ): Promise<ResetPasswordResponse> {
    const cleanRequestId = requestId.trim();
    const cleanResetToken = resetToken.trim();

    if (!cleanRequestId) {
      throw new Error("Password reset request is missing.");
    }

    if (!cleanResetToken) {
      throw new Error("Password reset authorization is missing.");
    }

    if (!newPassword) {
      throw new Error("New password is required.");
    }

    if (newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters long.");
    }

    const response = await fetch(`${API_BASE_URL}/auth/forgot-password/reset`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        requestId: cleanRequestId,
        resetToken: cleanResetToken,
        newPassword,
      }),
    });

    const data: ResetPasswordResponse & {
      error?: string;
    } = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Unable to reset the password.",
      );
    }

    return data;
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
    sessionStorage.removeItem("otp_resend_available_at");

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
  // LOGIN COOLDOWN
  //
  // GLOBAL for this browser tab/session.
  // It is not tied to a username.
  // =====================================================

  saveLoginCooldown(lockedUntil: number): void {
    saveLoginCooldownState(lockedUntil);
  },

  getLoginCooldownRemaining(): number {
    return getLoginCooldownRemainingState();
  },

  clearLoginCooldown(): void {
    clearLoginCooldownState();
  },

  // =====================================================
  // OTP RESEND COOLDOWN
  //
  // Stores the exact timestamp when Resend OTP becomes
  // available again. This keeps the countdown accurate
  // even if the OTP page re-renders or refreshes.
  // =====================================================

  saveOtpResendAvailableAt(timestamp: number): void {
    sessionStorage.setItem(
      "otp_resend_available_at",
      String(Math.max(0, Math.floor(timestamp))),
    );
  },

  getOtpResendAvailableAt(): number | null {
    const stored = sessionStorage.getItem("otp_resend_available_at");

    if (!stored) {
      return null;
    }

    const timestamp = Number(stored);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      sessionStorage.removeItem("otp_resend_available_at");
      return null;
    }

    return timestamp;
  },

  clearOtpResendAvailableAt(): void {
    sessionStorage.removeItem("otp_resend_available_at");
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

    sessionStorage.removeItem("otp_resend_available_at");

    clearLoginCooldownState();
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

      Finance: "/finance/dashboard",

      Student: "/student/dashboard",
    };

    return routes[role];
  },
};
