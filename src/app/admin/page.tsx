/**
 * Admin dashboard (issue #176). Reachable by direct URL only — no nav link.
 *
 * Server-side gate: resolve the Clerk user to their `users` row (`ensureUser`,
 * issue #48 — provisions the row on first authenticated access so any
 * signed-in user resolves) and require `isAdmin`. A non-admin (including an
 * unauthenticated visitor) gets a plain 404 rather than a 403 — the admin
 * surface isn't advertised. Data fetching (stats, charts, reports queue)
 * happens client-side in `AdminDashboard`; the API routes 404 non-admins
 * again (per #175's `requireAdmin`), so there's no gap where the data is
 * reachable without the gate.
 */

import { notFound } from "next/navigation";
import { ensureUser } from "@/lib/user";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export default async function AdminPage() {
  const user = await ensureUser();
  if (!user || !user.isAdmin) {
    notFound();
  }

  return <AdminDashboard />;
}
