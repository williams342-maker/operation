import axios from "axios";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", withCredentials: true });
api.interceptors.request.use((config) => { const csrf = localStorage.getItem("cc.csrf"); if (csrf && config.method?.toUpperCase() !== "GET") config.headers["x-csrf-token"] = csrf; return config; });
export function apiError(error: unknown) { return axios.isAxiosError(error) ? String(error.response?.data?.error || error.message) : error instanceof Error ? error.message : "Unknown error"; }
export async function bootstrapStatus() { return (await api.get("/auth/bootstrap")).data as { available: boolean }; }
export async function bootstrapOwner(input: { organizationName: string; organizationSlug: string; ownerEmail: string; ownerName: string; password: string }) { return (await api.post("/auth/bootstrap", input)).data; }
export async function login(organizationSlug: string, email: string, password: string) { const { data } = await api.post("/auth/login", { organizationSlug, email, password }); localStorage.setItem("cc.csrf", data.csrfToken); return data; }
export async function logout() { await api.post("/auth/logout"); localStorage.removeItem("cc.csrf"); }
