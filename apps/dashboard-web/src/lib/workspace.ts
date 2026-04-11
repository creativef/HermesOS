const COMPANY_KEY = "WORKSPACE_COMPANY_ID";
const PROJECT_KEY = "WORKSPACE_PROJECT_ID";

export function getSelectedCompanyId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(COMPANY_KEY) || "";
}

export function setSelectedCompanyId(companyId: string) {
  if (typeof window === "undefined") return;
  if (companyId) window.localStorage.setItem(COMPANY_KEY, companyId);
  else window.localStorage.removeItem(COMPANY_KEY);
}

export function getSelectedProjectId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PROJECT_KEY) || "";
}

export function setSelectedProjectId(projectId: string) {
  if (typeof window === "undefined") return;
  if (projectId) window.localStorage.setItem(PROJECT_KEY, projectId);
  else window.localStorage.removeItem(PROJECT_KEY);
}

