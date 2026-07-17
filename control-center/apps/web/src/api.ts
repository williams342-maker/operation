import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  withCredentials: true
});

api.interceptors.request.use((config) => {
  const csrf = localStorage.getItem("cc.csrf");
  if (csrf && config.method?.toUpperCase() !== "GET") config.headers["x-csrf-token"] = csrf;
  return config;
});

export async function login(organizationSlug: string, email: string, password: string) {
  const { data } = await api.post("/auth/login", { organizationSlug, email, password });
  localStorage.setItem("cc.csrf", data.csrfToken);
  return data;
}
