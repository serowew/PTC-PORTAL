// src/services/api.ts

// =====================================================
// API CONFIGURATION
// =====================================================
//
// Development default:
// http://localhost:3000
//
// Production:
// Set VITE_API_BASE_URL in the frontend environment.
//
// Example:
// VITE_API_BASE_URL=https://api.ptcportal.com
// =====================================================

const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (
  ENV_API_BASE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

// =====================================================
// API URL HELPER
// =====================================================

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${API_BASE_URL}${normalizedPath}`;
}

// =====================================================
// API CONFIG OBJECT
// =====================================================

export const api = {
  baseUrl: API_BASE_URL,
  url: apiUrl,
};
