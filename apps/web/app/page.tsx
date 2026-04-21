import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth-state";

export default async function HomePage() {
  const user = await getSessionUser();

  redirect(user ? "/causal" : "/login");
}
