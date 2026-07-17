import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000",
  withCredentials: true
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("dashboard.jwt");
  const csrf = localStorage.getItem("dashboard.csrf");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (csrf && config.method?.toUpperCase() !== "GET") config.headers["x-csrf-token"] = csrf;
  return config;
});

export async function ensureCsrf() {
  const { data } = await api.get<{ csrfToken: string }>("/api/csrf");
  localStorage.setItem("dashboard.csrf", data.csrfToken);
  return data.csrfToken;
}
