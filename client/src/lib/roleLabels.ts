type Role = "patient" | "agent" | "admin" | string | undefined;

export function getRoleTitle(role: Role): string {
  if (role === "agent") return "Care Specialist";
  if (role === "patient") return "Patient";
  if (role === "admin") return "Administrator";
  return "User";
}

export function getRoleModeLabel(role: Role): string {
  if (role === "agent") return "Care Specialist mode";
  if (role === "patient") return "Patient mode";
  if (role === "admin") return "Administrator mode";
  return "User mode";
}
