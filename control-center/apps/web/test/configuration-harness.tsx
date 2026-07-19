import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigurationPage } from "../src/ConfigurationPage";
import { api } from "../src/api";
import "../src/styles.css";

api.defaults.adapter = async (config) => ({ data: config.url === "/projects" ? { projects: [] } : config.url === "/configuration/environments" ? { environments: [] } : { definitions: [], versions: [] }, status: 200, statusText: "OK", headers: {}, config });

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><main className="min-h-screen bg-background p-4 text-text"><ConfigurationPage toast={() => undefined} /></main></QueryClientProvider></React.StrictMode>);
