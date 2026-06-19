import type { ReactNode } from "react";
import { AdminSessionBar } from "../../components/admin-session-bar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminSessionBar />
      {children}
    </>
  );
}
