"use client";

import { startTransition } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { isUserRole, type UserRole } from "@/lib/roles";

function buildUrl(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function buildRoleHref(pathname: string, role: UserRole) {
  const searchParams = new URLSearchParams();
  searchParams.set("role", role);

  return buildUrl(pathname, searchParams);
}

export function useRoleQueryState(fallbackRole: UserRole) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role");
  const role = isUserRole(roleParam) ? roleParam : fallbackRole;

  const setRole = (nextRole: UserRole) => {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("role", nextRole);

    startTransition(() => {
      router.replace(buildUrl(pathname, nextSearchParams), { scroll: false });
    });
  };

  return {
    role,
    setRole,
  };
}
